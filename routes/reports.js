const express = require('express');
const Report = require('../models/Report');
const { v4: uuidv4 } = require('uuid');

const { MongoClient} = require('mongodb');

const router = express.Router();

router.post('/', async (req, res) => {
	const { view, report } = req.body;

	try {
		const mongoClient = new MongoClient(process.env.MONGODB_URI);
		await mongoClient.connect();

		const db = mongoClient.db(view.viewDBName);

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
		await mongoClient.close();

		res.status(201).json({ message: `Report created successfully: ${REPORT_ID}.` });
	} catch (err) {
		console.error(err);
		res.status(500).json({ message: 'Failed to create the report', error: err.message });
	}
});

const parseFilterWithRegex = (filter) => {
	const traverse = (obj) => {
		for (const key in obj) {
			if (typeof obj[key] === 'object' && obj[key] !== null) {
				traverse(obj[key]);
			} else if (typeof obj[key] === 'string' && /^\/.*\/$/.test(obj[key])) {
				// Convert "/value/" to RegExp
				const pattern = obj[key].slice(1, -1);
				obj[key] = new RegExp(pattern, 'i'); // case-insensitive
			}
		}
		return obj;
	};
	return traverse(filter);
};

router.get('/:reportID', async (req, res) => {
	try {
		const { reportID } = req.params;
		const count = parseInt(req.query.count) || 10;
		const page = parseInt(req.query.page) || 0;
		const select = req.query.select;
		const rawFilter = req.query.filter;
		const sortParam = req.query.sort;

		// Step 1: Get report metadata
		const report = await Report.findOne({ id: reportID });
		if (!report)
			return res.status(404).json({ message: 'Report not found' });

		const viewName = report?.view?.name;
		const viewDBName = report?.view?.database;
		

		const mongoClient = new MongoClient(process.env.MONGODB_URI);
		await mongoClient.connect();

		const db = mongoClient.db(viewDBName);
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
				filter = parseFilterWithRegex(parsed);
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
			.skip(page)
			.sort(sort)
			.limit(count)
			.toArray();

		await mongoClient.close();

		res.json(data);
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

		// Step 1: Get report metadata
		const report = await Report.findOne({ id: reportID });
		if (!report)
			return res.status(404).json({ message: 'Report not found' });

		const viewName = report?.view?.name;
		const viewDBName = report?.view?.database;

		const mongoClient = new MongoClient(process.env.MONGODB_URI);
		await mongoClient.connect();

		const db = mongoClient.db(viewDBName);
		const collection = db.collection(viewName);

		let filter = {};
		if (rawFilter) {
			try {
				const parsed = JSON.parse(rawFilter);
				filter = parseFilterWithRegex(parsed);
			} catch (err) {
				return res.status(400).json({ message: 'Invalid filter format', error: err.message });
			}
		}

		const count = await collection.countDocuments(filter);

		await mongoClient.close();

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