// Simple in-memory state manager to track processed tweets and prevent duplicates
// This is for development purposes only. In production, use Vercel KV, Redis, or a database.

// In-memory storage for processed tweets
let processedTweets = new Map();
const MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

/**
 * Get the list of processed tweets with timestamps
 * @returns {Promise<Array>} Array of processed tweet objects with id and timestamp
 */
export async function getProcessedTweets() {
  try {
    // Clean up old entries first
    await cleanupOldTweets();
    
    // Convert Map to array of objects
    const tweets = [];
    for (const [id, data] of processedTweets.entries()) {
      tweets.push({
        id,
        ...data
      });
    }
    return tweets;
  } catch (error) {
    console.warn('Could not read processed tweets, returning empty array:', error.message);
    return [];
  }
}

/**
 * Add a processed tweet to the list
 * @param {string} tweetId - The tweet ID to add
 * @param {string} username - The username who sent the tweet
 * @param {string} text - The text of the tweet
 * @returns {Promise<void>}
 */
export async function addProcessedTweet(tweetId, username, text) {
  try {
    // Store tweet with timestamp and metadata
    processedTweets.set(tweetId, {
      username,
      text: text.substring(0, 280), // Limit text storage
      timestamp: Date.now(),
      processedAt: new Date().toISOString()
    });
    
    console.log(`Added processed tweet: ${tweetId} from @${username}`);
  } catch (error) {
    console.error('Could not add processed tweet:', error.message);
  }
}

/**
 * Check if a tweet has already been processed
 * @param {string} tweetId - The tweet ID to check
 * @returns {Promise<boolean>} True if the tweet has been processed, false otherwise
 */
export async function isTweetProcessed(tweetId) {
  try {
    // Clean up old entries first
    await cleanupOldTweets();
    
    // Check if tweet exists in our Map
    return processedTweets.has(tweetId);
  } catch (error) {
    console.warn('Could not check if tweet is processed, assuming not processed:', error.message);
    return false;
  }
}

/**
 * Clean up old processed tweets (older than 24 hours)
 * @returns {Promise<void>}
 */
export async function cleanupOldTweets() {
  try {
    const now = Date.now();
    let cleanedCount = 0;
    
    // Iterate through entries and remove old ones
    for (const [id, data] of processedTweets.entries()) {
      if (now - data.timestamp > MAX_AGE) {
        processedTweets.delete(id);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      console.log(`Cleaned up ${cleanedCount} old processed tweets`);
    }
  } catch (error) {
    console.error('Could not clean up old tweets:', error.message);
  }
}

/**
 * Get statistics about processed tweets
 * @returns {Promise<Object>} Statistics object
 */
export async function getProcessingStats() {
  try {
    await cleanupOldTweets();
    
    const now = Date.now();
    let lastHourCount = 0;
    let last24HourCount = 0;
    
    for (const data of processedTweets.values()) {
      const age = now - data.timestamp;
      if (age < 60 * 60 * 1000) { // Less than 1 hour
        lastHourCount++;
      }
      if (age < 24 * 60 * 60 * 1000) { // Less than 24 hours
        last24HourCount++;
      }
    }
    
    return {
      totalProcessed: processedTweets.size,
      lastHour: lastHourCount,
      last24Hours: last24HourCount
    };
  } catch (error) {
    console.error('Could not get processing stats:', error.message);
    return {
      totalProcessed: 0,
      lastHour: 0,
      last24Hours: 0
    };
  }
}