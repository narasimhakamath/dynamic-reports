const express = require('express');
const { MongoClient } = require('mongodb');
const { v4: uuidv4 } = require('uuid');

const Report = require('../models/Report');
const parseFilter = require('./parseFilter');
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

		res.status(201).json({ message: `Report created successfully: ${REPORT_ID}.` });
	} catch (err) {
		console.error(err);
		res.status(500).json({ message: 'Failed to create the report', error: err.message });
	}
});

router.get('/:reportID', async (req, res) => {
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
		res.json({
			data,
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
			message: 'Failed to fetch report data',
			success: false,
			code: 500,
			error: err.message
		});
	}
});

router.get('/:reportID/count', async (req, res) => {
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

module.exports = router;