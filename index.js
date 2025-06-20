require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const reportRoutes = require('./routes/reports');
const notificationsRoutes = require('./routes/notifications');

const connectDB = require('./utils/database');
const { closeAllConnections } = require('./utils/connectionManager');

connectDB();

const allowedOrigins = ['http://localhost:3000', 'https://yourdomain.com'];

const app = express();
app.use(express.json());

app.use(cors({
	origin: function(origin, callback) {
		if (!origin || allowedOrigins.includes(origin)) {
			callback(null, true);
		} else {
			callback(new Error('Not allowed by CORS'));
		}
	},
	methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
	credentials: true
}));

app.use(bodyParser.json());

app.use('/insights/reports', reportRoutes);
app.use('/insights/notifications', notificationsRoutes);

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM signal received: closing HTTP server and database connections');
  server.close(async () => {
    console.log('HTTP server closed');
    // Clear any in-memory caches
    const { reportCache } = require('./utils/cache');
    reportCache.clear();
    await closeAllConnections();
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('SIGINT signal received: closing HTTP server and database connections');
  server.close(async () => {
    console.log('HTTP server closed');
    // Clear any in-memory caches
    const { reportCache } = require('./utils/cache');
    reportCache.clear();
    await closeAllConnections();
    process.exit(0);
  });
});