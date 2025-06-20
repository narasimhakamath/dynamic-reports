const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema({
    user: { type: String, required: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    type: { type: String, default: 'info' }, // e.g., info, warning, error
    read: { type: Boolean, default: false },
    clicked: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, default: () => new Date(Date.now() + 15 * 24 * 60 * 60 * 1000) }
});

// TTL index for automatic expiration after 15 days
NotificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('Notification', NotificationSchema); 