const { MongoClient } = require('mongodb');

// Cache for MongoDB connections
const connectionPool = {};

/**
 * Get or create a MongoDB connection
 * @param {string} dbName - Database name to connect to
 * @returns {Promise<{client: MongoClient, db: any}>}
 */
const getConnection = async (dbName) => {
  // Check if we already have this connection in the pool
  if (connectionPool[dbName] && connectionPool[dbName].client.topology.isConnected()) {
    return connectionPool[dbName];
  }

  // Create a new connection
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(dbName);
  
  // Store in pool for reuse
  connectionPool[dbName] = { client, db };
  
  return connectionPool[dbName];
};

/**
 * Close all connections in the pool
 */
const closeAllConnections = async () => {
  const closePromises = Object.values(connectionPool).map(async ({ client }) => {
    if (client.topology && client.topology.isConnected()) {
      await client.close();
    }
  });
  
  await Promise.all(closePromises);
  
  // Clear the pool
  Object.keys(connectionPool).forEach(key => delete connectionPool[key]);
};

module.exports = {
  getConnection,
  closeAllConnections
};