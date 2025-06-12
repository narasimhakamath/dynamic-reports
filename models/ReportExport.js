const mongoose = require('mongoose');

const reportExportSchema = new mongoose.Schema({
    _id: {
        type: String,
        required: true
    },
    user: {
        type: String,
        required: true
    },
    reportId: {
        type: String,
        required: true
    },
    _metadata: {
        lastUpdated: {
            type: Date,
            default: Date.now
        },
        createdAt: {
            type: Date,
            default: Date.now
        },
        deleted: {
            type: Boolean,
            default: false
        },
        version: {
            document: {
                type: Number,
                default: 1
            }
        },
        viewed: {
            type: Boolean,
            default: false
        },
        viewedAt: {
            type: Date,
            default: null
        },
        expiresAt: {
            type: Date,
            default: null
        }
    },
    status: {
        type: String,
        enum: ['Pending', 'Processing', 'Completed', 'Failed'],
        default: 'Pending'
    },
    fileName: {
        type: String,
        required: true
    },
    recordCount: {
        type: Number,
        default: 0
    },
    filter: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    }
}, {
    timestamps: true,
    versionKey: false
});

// Create TTL index on _metadata.expiresAt
reportExportSchema.index({ '_metadata.expiresAt': 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('ReportExport', reportExportSchema); 