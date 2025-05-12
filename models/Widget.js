const mongoose = require('mongoose');

const WidgetSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true,
    unique: true,
  },
  query: {
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
  widget: {
    name: {
      type: String,
      required: true,
    },
    description: {
      type: String,
    },
    type: {
      type: String,
      required: true, // e.g., 'line_chart', 'bar_chart', etc.
      enum: ["LINECHART", "BARCHART", "PIECHART"]
    },
    xAxisLabel: {
      type: String,
    },
    yAxisLabel: {
      type: String
    },
    options: {
      type: Object,
      default: {},
    },
  },
}, { timestamps: true });

module.exports = mongoose.model('Widget', WidgetSchema);