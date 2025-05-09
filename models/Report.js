const mongoose = require('mongoose');

const ReportSchema = new mongoose.Schema({
	id: {
		type: String,
		unique: true,
		required: true,
		index: true // Add index for faster lookup
	},
	view: {
		name: {
			type: String,
			required: true
		},
		pipeline: {
			type: Array,
			required: true
		},
		sourceCollection: {
			type: String,
			required: true
		},
		database: {
			type: String,
			required: true
		},
	},
	report: {
		name: {
			type: String,
			required: true,
			unique: true,
			index: true // Add index for report name lookups
		},
		description: {
			type: String,
		},
		fields: {
			type: Array,
			required: true
		},
		filters: {
			type: Array,
			required: true
		},
		searchable: {
			type: [String]
		}
	},
	isCrossDB: {
		type: Boolean,
		default: false
	},
}, { timestamps: true });

const Report = mongoose.model('Report', ReportSchema);
module.exports = Report;