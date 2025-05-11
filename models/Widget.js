const mongoose = require('mongoose');

const WidgetSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true,
    unique: true,
  },
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
  },
  query: {
    database: {
      type: String,
      required: true,
    },
    collection: {
      type: String,
      required: true,
    },
    pipeline: {
      type: Array,
      required: true, // MongoDB aggregation pipeline
    },
  },
  options: {
    type: Object, // UI-specific options like colors, labels, etc.
    default: {},
  },
}, { timestamps: true });

module.exports = mongoose.model('Widget', WidgetSchema);