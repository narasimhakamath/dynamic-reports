/**
 * Simple in-memory LRU cache implementation
 * with optional TTL (Time-To-Live) support
 */
class LRUCache {
  constructor(maxSize = 100, defaultTTL = 300000) { // Default TTL: 5 minutes (300000ms)
    this.cache = new Map();
    this.maxSize = maxSize;
    this.defaultTTL = defaultTTL;
    this.expiryTimes = new Map();
  }

  get(key) {
    if (!this.cache.has(key)) return null;

    // Check if the item has expired
    if (this.expiryTimes.has(key)) {
      const expiryTime = this.expiryTimes.get(key);
      if (Date.now() > expiryTime) {
        // Remove expired item
        this.cache.delete(key);
        this.expiryTimes.delete(key);
        return null;
      }
    }

    // Access refreshes the item (LRU behavior)
    const value = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, value);

    // Also update expiry if it exists
    if (this.expiryTimes.has(key)) {
      const ttl = this.expiryTimes.get(key) - Date.now();
      this.expiryTimes.delete(key);
      this.expiryTimes.set(key, Date.now() + ttl);
    }

    return value;
  }

  set(key, value, ttl = this.defaultTTL) {
    // Delete if exists to refresh position
    if (this.cache.has(key)) {
      this.cache.delete(key);
      if (this.expiryTimes.has(key)) {
        this.expiryTimes.delete(key);
      }
    }

    // Evict oldest item if full
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
      if (this.expiryTimes.has(oldestKey)) {
        this.expiryTimes.delete(oldestKey);
      }
    }

    this.cache.set(key, value);

    // Set expiry time if ttl is provided
    if (ttl > 0) {
      this.expiryTimes.set(key, Date.now() + ttl);
    }
  }

  invalidate(key) {
    this.cache.delete(key);
    if (this.expiryTimes.has(key)) {
      this.expiryTimes.delete(key);
    }
  }

  clear() {
    this.cache.clear();
    this.expiryTimes.clear();
  }

  // Get cache stats for monitoring
  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      defaultTTL: this.defaultTTL,
      activeExpiryTimers: this.expiryTimes.size
    };
  }
}

// Export singleton instances
// reportCache: For report metadata (longer TTL)
const reportCache = new LRUCache(100, 600000); // 10 minutes TTL

// resultCache: For query results (shorter TTL)
const resultCache = new LRUCache(50, 60000); // 1 minute TTL

module.exports = {
  reportCache,
  resultCache,
  LRUCache // Export class for testing/customization
};