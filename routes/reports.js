const express = require('express');
const { MongoClient } = require('mongodb');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const archiver = require('archiver');
const { createObjectCsvWriter } = require('csv-writer');

const Report = require('../models/Report');
const ReportExport = require('../models/ReportExport');
const parseFilter = require('../utils/parseFilter');
const { getConnection } = require('../utils/connectionManager');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const reports = await Report.find({});
    const formattedReports = reports.map(report => ({
      id: report.id,
      name: report.report.name,
      description: report.report.description,
      fields: report.report.fields,
      filters: report.report.filters,
      searchable: report.report.searchable
    }));

    res.json(formattedReports);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: 'Failed to fetch reports list',
      success: false,
      code: 500,
      error: err.message
    });
  }
});

router.post('/', async (req, res) => {
	const { view, report } = req.body;

	try {
		// Get connection from pool
		const { db } = await getConnection(view.viewDBName);

		const collections = await db.listCollections({ name: view.viewName }).toArray();
		if (collections.length > 0) {
			console.log(`Dropping existing view: ${view.viewName}`);
			await db.collection(view.viewName).drop();
		}

		await db.createCollection(view.viewName, {
			viewOn: view.sourceCollection,
			pipeline: view.pipeline
		});

		const REPORT_ID = uuidv4();
		// Save to report_masters collection (uses PRIMARY_DB)
		const reportRecord = new Report({
			id: REPORT_ID,
			view: {
				name: view.viewName,
				pipeline: view.pipeline,
				sourceCollection: view.sourceCollection,
				database: view.viewDBName,
			},
			report: {
				name: report.name,
				description: report?.description || null,
				fields: report.fields,
				filters: report.filters,
				searchable: report.searchable
			},
			isCrossDB: report.isCrossDB || false
		});

		await reportRecord.save();
		// We don't close the connection - it stays in the pool for reuse

		res.status(201).json({ message: `Report created successfully`, reportId: REPORT_ID });
	} catch (err) {
		console.error(err);
		res.status(500).json({ message: 'Failed to create the report', error: err.message });
	}
});

router.get('/read/:reportID', async (req, res) => {
	try {
		const reportID = req?.params?.reportID;
		const select = req.query.select;
		const rawFilter = req.query.filter;
		const sortParam = req.query.sort;

		const page = parseInt(req?.query?.page) || 1;
		const count = parseInt(req?.query?.count) || 10;
		const offset = (page - 1) * count;

		// Create a cache key based on report ID
		const { reportCache } = require('../utils/cache');
		const cacheKey = `report_${reportID}`;

		// Try to get report from cache first
		let report = reportCache.get(cacheKey);

		// If not in cache, fetch from database and cache it
		if (!report) {
			// Step 1: Get report metadata
			report = await Report.findOne({ id: reportID });
			if (!report)
				return res.status(404).json({ message: 'Report not found' });

			// Store in cache for future requests
			reportCache.set(cacheKey, report);
		}

		const viewName = report?.view?.name;
		const viewDBName = report?.view?.database;

		const { db } = await getConnection(viewDBName);
		const collection = db.collection(viewName);

		const projection = {};
		if(select) {
			const fields = select?.split(',')?.map(f => f.trim()).filter(Boolean);
			fields.forEach(field => {
				projection[field] = 1;
			});
		}

		let filter = {};
		if (rawFilter) {
			try {
				const parsed = JSON.parse(rawFilter);
				filter = parseFilter(parsed);
			} catch (err) {
				return res.status(400).json({ message: 'Invalid filter format', error: err.message });
			}
		}

		let sort = {};
		if (sortParam) {
			if (sortParam.startsWith('-'))
				sort[sortParam.substring(1)] = -1; // Descending
			else
				sort[sortParam] = 1; // Ascending
		}

		const data = await collection.find(filter, { projection })
			.skip(offset)
			.sort(sort)
			.limit(count)
			.toArray();
			
		// Get total count for pagination
		const totalCount = await collection.countDocuments(filter);
		const totalPages = Math.ceil(totalCount / count);
		
		// Return in standard pagination format
		res.json(data);
		// res.json({
		// 	data,
		// 	pagination: {
		// 		page,
		// 		count,
		// 		totalCount,
		// 		totalPages,
		// 		hasNextPage: page < totalPages,
		// 		hasPrevPage: page > 1
		// 	}
		// });
	} catch (err) {
		console.error(err);
		res.status(500).json({
			message: 'Failed to fetch report data',
			success: false,
			code: 500,
			error: err.message
		});
	}
});

router.get('/read/:reportID/count', async (req, res) => {
	try {
		const { reportID } = req.params;
		const rawFilter = req.query.filter;

		// Create a cache key based on report ID
		const { reportCache } = require('../utils/cache');
		const cacheKey = `report_${reportID}`;

		// Try to get report from cache first
		let report = reportCache.get(cacheKey);

		// If not in cache, fetch from database and cache it
		if (!report) {
			// Step 1: Get report metadata
			report = await Report.findOne({ id: reportID });
			if (!report)
				return res.status(404).json({ message: 'Report not found' });

			// Store in cache for future requests
			reportCache.set(cacheKey, report);
		}

		const viewName = report?.view?.name;
		const viewDBName = report?.view?.database;

		// Get connection from pool instead of creating a new one
		const { db } = await getConnection(viewDBName);
		const collection = db.collection(viewName);

		let filter = {};
		if (rawFilter) {
			try {
				const parsed = JSON.parse(rawFilter);
				filter = parseFilter(parsed);
			} catch (err) {
				return res.status(400).json({ message: 'Invalid filter format', error: err.message });
			}
		}

		const count = await collection.countDocuments(filter);

		// We don't close the connection - it stays in the pool for reuse

		res.json(count);
	} catch (err) {
		console.error(err);
		res.status(500).json({
			message: 'Failed to count report data',
			success: false,
			code: 500,
			error: err.message
		});
	}
});

// Helper function to process export in background
async function processExport(exportId, reportId, query, user) {
	console.log('processExport()');
	console.log('exportId:', exportId);
	console.log('reportId:', reportId);
	console.log('query:', JSON.stringify(query, null, 2));
	console.log('user:', user);

	try {
		// Update status to Processing
		await ReportExport.findByIdAndUpdate(exportId, {
			status: 'Processing',
			'_metadata.lastUpdated': new Date()
		});

		const report = await Report.findOne({ id: reportId });
		if (!report) {
			throw new Error('Report not found');
		}

		console.log('Report found:', {
			viewName: report.view.name,
			database: report.view.database,
			fields: report.report.fields
		});

		const { db } = await getConnection(report.view.database);
		const collection = db.collection(report.view.name);

		// Log the query and collection details
		console.log('Collection name:', report.view.name);
		console.log('Database name:', report.view.database);
		console.log('Final query:', JSON.stringify(query, null, 2));

		// First, check if we have any records
		const count = await collection.countDocuments(query);
		console.log('Total records matching query:', count);

		if (count === 0) {
			// Update export record to indicate no data
			await ReportExport.findByIdAndUpdate(exportId, {
				status: 'Completed',
				recordCount: 0,
				'_metadata.lastUpdated': new Date()
			});
			console.log('No records found, skipping file generation');
			return;
		}

		// Use absolute paths
		const baseDir = process.cwd();
		const exportsDir = path.join(baseDir, 'exports');
		
		// Create directories with proper error handling
		try {
			await fsPromises.mkdir(exportsDir, { recursive: true });
			
			// Create export directory
			const exportDir = path.join(exportsDir, exportId);
			await fsPromises.mkdir(exportDir, { recursive: true });
			
			// Create CSV file
			const csvPath = path.join(exportDir, 'data.csv');
			console.log('CSV path:', csvPath);

			// Get the fields from the report
			const fields = report.report.fields;
			console.log('Fields to export:', fields);

			const csvWriter = createObjectCsvWriter({
				path: csvPath,
				header: fields.map(field => ({
					id: field.key,
					title: field.label
				}))
			});

			// Stream data to CSV
			const cursor = collection.find(query);
			const records = [];
			let recordCount = 0;

			console.log('Starting to process records...');
			while (await cursor.hasNext()) {
				const doc = await cursor.next();
				console.log('Processing document:', JSON.stringify(doc, null, 2));
				const record = {};
				
				// Process each field
				fields.forEach(field => {
					const fieldKey = field.key;
					// Handle nested fields with dot notation
					const keys = fieldKey.split('.');
					let value = doc;
					
					// Navigate through the nested structure
					for (const key of keys) {
						if (value === null || value === undefined) {
							value = '';
							break;
						}
						value = value[key];
					}

					// Convert the value to a string representation based on field type
					if (value === null || value === undefined) {
						record[fieldKey] = '';
					} else if (typeof value === 'object') {
						// For objects, use JSON.stringify with proper formatting
						try {
							record[fieldKey] = JSON.stringify(value, null, 0);
						} catch (err) {
							console.error(`Error stringifying value for field ${fieldKey}:`, err);
							record[fieldKey] = '';
						}
					} else if (field.type === 'Number') {
						// Handle number type specifically
						record[fieldKey] = Number(value).toString();
					} else if (field.type === 'Boolean') {
						// Handle boolean type specifically
						record[fieldKey] = Boolean(value).toString();
					} else {
						// Default to string conversion
						record[fieldKey] = String(value);
					}
				});

				// Debug log for first record
				if (recordCount === 0) {
					console.log('First record processed:', record);
				}
				
				records.push(record);
				recordCount++;

				// Write in batches of 1000
				if (records.length >= 1000) {
					console.log(`Writing batch of ${records.length} records...`);
					await csvWriter.writeRecords(records);
					console.log('Batch written successfully');
					records.length = 0;
				}
			}

			// Write any remaining records
			if (records.length > 0) {
				console.log(`Writing final batch of ${records.length} records...`);
				await csvWriter.writeRecords(records);
				console.log('Final batch written successfully');
			}

			console.log(`Total records processed: ${count}`);

			// Create ZIP file
			const zipPath = path.join(exportsDir, `${exportId}.zip`);
			console.log('Creating ZIP file at:', zipPath);
			
			const output = fs.createWriteStream(zipPath);
			const archive = archiver('zip', { zlib: { level: 9 } });

			output.on('close', () => {
				console.log(`ZIP file created: ${zipPath}`);
			});

			archive.on('error', (err) => {
				console.error('ZIP error:', err);
				throw err;
			});

			archive.pipe(output);
			archive.file(csvPath, { name: 'data.csv' });
			await archive.finalize();

			// Wait a moment to ensure files are written
			await new Promise(resolve => setTimeout(resolve, 1000));

			// Verify files exist before cleanup
			console.log('Verifying files before cleanup...');
			try {
				const csvStats = await fsPromises.stat(csvPath);
				const zipStats = await fsPromises.stat(zipPath);
				console.log('Files verified:', {
					csv: { path: csvPath, size: csvStats.size },
					zip: { path: zipPath, size: zipStats.size }
				});
			} catch (error) {
				console.error('File verification failed:', error);
				throw new Error('Files were not created successfully');
			}

			// Clean up the CSV file after ZIP is created
			console.log('Cleaning up CSV file...');
			await fsPromises.unlink(csvPath);
			await fsPromises.rmdir(exportDir);
			console.log('Cleanup complete');

			// Update export record
			await ReportExport.findByIdAndUpdate(exportId, {
				status: 'Completed',
				recordCount: count,
				'_metadata.lastUpdated': new Date()
			});

		} catch (error) {
			console.error('Error in file operations:', error);
			throw error;
		}

	} catch (error) {
		console.error('Export processing error:', error);
		await ReportExport.findByIdAndUpdate(exportId, {
			status: 'Failed',
			'_metadata.lastUpdated': new Date()
		});
		throw error;
	}
}

// Route to initiate export
router.post('/export/:reportId', async (req, res) => {
	try {
		const { filter, totalRecords } = req.body;
		const { reportId } = req.params;
		const user = 'appadmin@datanimbus.com';

		if (!reportId) {
			return res.status(400).json({
				message: 'Report ID and user are required',
				success: false
			});
		}

		// Process the filter using the parseFilter utility
		let processedFilter = {};
		if (filter) {
			try {
				const parsedFilter = typeof filter === 'string' ? JSON.parse(filter) : filter;
				console.log('Original filter:', JSON.stringify(parsedFilter, null, 2));
				
				// Use the parseFilter utility for consistent filter handling
				processedFilter = parseFilter(parsedFilter);
				console.log('Processed filter:', JSON.stringify(processedFilter, null, 2));
			} catch (err) {
				console.error('Error processing filter:', err);
				return res.status(400).json({
					message: 'Invalid filter format',
					success: false,
					error: err.message
				});
			}
		}

		// Create export record
		const exportId = uuidv4();
		const fileName = `Report-${reportId}-${new Date().toISOString().slice(0,10)}.zip`;

		const reportExport = new ReportExport({
			_id: exportId,
			user,
			reportId,
			fileName,
			filter: processedFilter,
			status: 'Pending'
		});

		await reportExport.save();

		// Start background processing
		processExport(exportId, reportId, processedFilter, user).catch(console.error);

		// Return immediately with the export ID
		res.status(202).json({
			message: 'Export initiated',
			exportId,
			status: 'Pending'
		});

	} catch (error) {
		console.error('Export initiation error:', error);
		res.status(500).json({
			message: 'Failed to initiate export',
			success: false,
			error: error.message
		});
	}
});

// Add cleanup function at the top level
async function cleanupExpiredExports() {
    try {
        const baseDir = process.cwd();
        const exportsDir = path.join(baseDir, 'exports');
        
        // Find all expired exports
        const expiredExports = await ReportExport.find({
            '_metadata.expiresAt': { $lt: new Date() },
            '_metadata.deleted': false
        });

        console.log(`Found ${expiredExports.length} expired exports to clean up`);

        for (const exportRecord of expiredExports) {
            const zipPath = path.join(exportsDir, `${exportRecord._id}.zip`);
            
            try {
                // Delete the ZIP file if it exists
                await fsPromises.access(zipPath);
                await fsPromises.unlink(zipPath);
                console.log(`Deleted expired file: ${zipPath}`);
            } catch (error) {
                if (error.code !== 'ENOENT') {
                    console.error(`Error deleting file ${zipPath}:`, error);
                }
            }

            // Mark as deleted in database
            await ReportExport.findByIdAndUpdate(exportRecord._id, {
                '_metadata.deleted': true,
                '_metadata.deletedAt': new Date()
            });
        }
    } catch (error) {
        console.error('Error in cleanup process:', error);
    }
}

// Run cleanup every hour
setInterval(cleanupExpiredExports, 60 * 60 * 1000);

// Run initial cleanup after 1 hour delay
setTimeout(cleanupExpiredExports, 60 * 60 * 1000);

// Modify the exports route to include cleanup
router.get('/exports', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const count = parseInt(req.query.count) || 10;
        const sort = req.query.sort || '-_metadata.lastUpdated';

        // Parse sort parameter
        let sortObj = {};
        if (sort.startsWith('-')) {
            sortObj[sort.substring(1)] = -1;
        } else {
            sortObj[sort] = 1;
        }

        // Build query
        const query = {
            '_metadata.deleted': false
        };

        // Get exports
        const exports = await ReportExport.find(query)
            .sort(sortObj)
            .skip((page - 1) * count)
            .limit(count)
            .select('_id fileName reportId _metadata.viewed _metadata.createdAt _metadata.expiresAt');

        // Get total count for pagination
        const totalCount = await ReportExport.countDocuments(query);
        const totalPages = Math.ceil(totalCount / count);

        res.json({
            data: exports,
            pagination: {
                page,
                count,
                totalCount,
                totalPages,
                hasNextPage: page < totalPages,
                hasPrevPage: page > 1
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({
            message: 'Failed to fetch exports',
            success: false,
            code: 500,
            error: err.message
        });
    }
});

// Route to download export
router.get('/exports/:exportId/download', async (req, res) => {
	try {
		const { exportId } = req.params;
		const exportRecord = await ReportExport.findById(exportId);

		if (!exportRecord) {
			return res.status(404).json({
				message: 'Export not found',
				success: false
			});
		}

		if (exportRecord.status !== 'Completed') {
			return res.status(400).json({
				message: 'Export is not ready for download',
				status: exportRecord.status,
				success: false
			});
		}

		const filePath = path.join(__dirname, '../exports', `${exportId}.zip`);
		
		// Check if file exists
		try {
			await fsPromises.access(filePath);
		} catch (error) {
			return res.status(404).json({
				message: 'Export file not found',
				success: false
			});
		}

		// Set headers for file download
		res.setHeader('Content-Type', 'application/zip');
		res.setHeader('Content-Disposition', `attachment; filename="${exportRecord.fileName}"`);
		
		// Stream the file
		const fileStream = fs.createReadStream(filePath);
		fileStream.pipe(res);

	} catch (error) {
		console.error('Download error:', error);
		res.status(500).json({
			message: 'Failed to download export',
			success: false,
			error: error.message
		});
	}
});

// Route to mark export as viewed
router.post('/exports/:exportId/viewed', async (req, res) => {
	try {
		const { exportId } = req.params;
		const { retentionDays = 7 } = req.body; // Allow custom retention period
		
		// Calculate expiry date
		const expiresAt = new Date();
		expiresAt.setDate(expiresAt.getDate() + retentionDays);
		
		await ReportExport.findByIdAndUpdate(exportId, {
			'_metadata.viewed': true,
			'_metadata.viewedAt': new Date(),
			'_metadata.expiresAt': expiresAt,
			'_metadata.lastUpdated': new Date()
		});

		res.json({
			message: 'Export marked as viewed',
			success: true,
			expiresAt
		});
	} catch (error) {
		console.error('Error marking export as viewed:', error);
		res.status(500).json({
			message: 'Failed to mark export as viewed',
			success: false,
			error: error.message
		});
	}
});

// Add cleanup function for physical files
async function cleanupOldExportFiles() {
    try {
        const baseDir = process.cwd();
        const exportsDir = path.join(baseDir, 'exports');
        
        // Get all files in exports directory
        const files = await fsPromises.readdir(exportsDir);
        
        // Get current time
        const now = new Date();
        
        for (const file of files) {
            const filePath = path.join(exportsDir, file);
            const stats = await fsPromises.stat(filePath);
            
            // Delete files older than 7 days
            const fileAge = now - stats.mtime;
            const sevenDaysInMs = 7 * 24 * 60 * 60 * 1000;
            
            if (fileAge > sevenDaysInMs) {
                try {
                    await fsPromises.unlink(filePath);
                    console.log(`Deleted old export file: ${filePath}`);
                } catch (error) {
                    console.error(`Error deleting file ${filePath}:`, error);
                }
            }
        }
    } catch (error) {
        console.error('Error in file cleanup process:', error);
    }
}

// Run cleanup every day
setInterval(cleanupOldExportFiles, 24 * 60 * 60 * 1000);

// Run initial cleanup on startup
cleanupOldExportFiles();

module.exports = router;