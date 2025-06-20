const express = require('express');
const Notification = require('../models/Notification');
const router = express.Router();

// Create a notification for a user or multiple users
router.post('/', async (req, res) => {
    try {
        const { user, userId, userIds, title, message, type } = req.body;
        // Accept either userId (string) or userIds (array)
        const singleUser = user || userId;
        const users = Array.isArray(userIds) ? userIds : (singleUser ? [singleUser] : []);
        if (!users.length) {
            return res.status(400).json({ message: 'userId or userIds is required' });
        }
        const notifications = await Notification.insertMany(
            users.map(u => ({ user: u, title, message, type }))
        );
        res.status(201).json({ message: 'Notification(s) created', notifications });
    } catch (err) {
        res.status(500).json({ message: 'Failed to create notification', error: err.message });
    }
});

// Get all notifications for a user
// router.get('/user/:user', async (req, res) => {
//     try {
//         const notifications = await Notification.find({ user: req.params.user }).sort({ createdAt: -1 });
//         res.json(notifications);
//     } catch (err) {
//         res.status(500).json({ message: 'Failed to fetch notifications', error: err.message });
//     }
// });


// Mark a notification as read
router.patch('/:id/read', async (req, res) => {
    try {
        const notification = await Notification.findByIdAndUpdate(req.params.id, { isRead: true, updatedAt: new Date() }, { new: true });
        if (!notification) return res.status(404).json({ message: 'Notification not found' });
        res.json({ message: 'Notification marked as read', notification });
    } catch (err) {
        res.status(500).json({ message: 'Failed to mark as read', error: err.message });
    }
});

// Mark a notification as clicked
router.patch('/:id/clicked', async (req, res) => {
    try {
        const notification = await Notification.findByIdAndUpdate(req.params.id, { isClicked: true, updatedAt: new Date() }, { new: true });
        if (!notification) return res.status(404).json({ message: 'Notification not found' });
        res.json({ message: 'Notification marked as clicked', notification });
    } catch (err) {
        res.status(500).json({ message: 'Failed to mark as clicked', error: err.message });
    }
});

// Mark all notifications as read for a user
// router.patch('/user/:user/read-all', async (req, res) => {
//     try {
//         await Notification.updateMany({ user: req.params.user, read: false }, { read: true, updatedAt: new Date() });
//         res.json({ message: 'All notifications marked as read' });
//     } catch (err) {
//         res.status(500).json({ message: 'Failed to mark all as read', error: err.message });
//     }
// });

router.patch('/read-all', async (req, res) => {
    try {
        await Notification.updateMany({ isRead: false }, { isRead: true, updatedAt: new Date() });
        res.json({ message: 'All notifications marked as read' });
    } catch (err) {
        res.status(500).json({ message: 'Failed to mark all as read', error: err.message });
    }
});

// Delete a notification
router.delete('/:id', async (req, res) => {
    try {
        const notification = await Notification.findByIdAndDelete(req.params.id);
        if (!notification) return res.status(404).json({ message: 'Notification not found' });
        res.json({ message: 'Notification deleted', notification });
    } catch (err) {
        res.status(500).json({ message: 'Failed to delete notification', error: err.message });
    }
});

// Paginated notifications list for the current user
router.get('/', async (req, res) => {
    try {
        // In the future, userId will be set from JWT middleware
        // const userId = req.user?.id || req.user || req.query.userId; // fallback for now
        // if (!userId) {
        //     return res.status(400).json({ message: 'User ID is required (will be autofetched from JWT in production)' });
        // }
        const page = parseInt(req?.query?.page) || 1;
        const count = parseInt(req?.query?.count) || 10;
        const skip = (page - 1) * count;
        // const query = { user: userId };
        const query = {};

        const projection = {
            _id: 1,
            title: 1,
            message: 1,
            isRead: 1,
            isClicked: 1
        };

        const notifications = await Notification.find(query, projection)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(count);

        res.json(notifications);
    } catch (err) {
        res.status(500).json({ message: 'Failed to fetch notifications', error: err.message });
    }
});

module.exports = router; 