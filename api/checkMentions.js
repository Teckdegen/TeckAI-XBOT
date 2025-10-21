import { TwitterApi } from 'twitter-api-v2';
import { generateGroqResponse } from '../utils/twitter.js';
import { postTwitterReply } from '../utils/twitter.js';
import { addProcessedTweet, isTweetProcessed, getProcessingStats } from '../utils/stateManager.js';

// Vercel serverless function to check mentions with timeout handling
export default async function handler(req, res) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const startTime = Date.now(); // Track execution time
  const maxExecutionTime = 25000; // Leave buffer before Vercel's timeout

  try {
    // Initialize Twitter client with Bearer token for read operations
    const twitterClient = new TwitterApi(process.env.TWITTER_BEARER_TOKEN);
    const readOnlyClient = twitterClient.readOnly;

    // Get the bot's username from environment variables
    const botUsername = process.env.BOT_USERNAME;

    if (!botUsername) {
      throw new Error('BOT_USERNAME environment variable is not set');
    }

    // Get processing statistics
    const stats = await getProcessingStats();
    console.log(`Processing stats: ${JSON.stringify(stats)}`);

    // Search for recent mentions of the bot with timeout
    const searchParams = {
      max_results: 10,
      'tweet.fields': ['id', 'text', 'author_id', 'created_at'],
      'user.fields': ['username', 'name'],
      expansions: ['author_id']
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout for Twitter API

    const mentions = await readOnlyClient.v2.search(`@${botUsername} -is:retweet`, searchParams);
    clearTimeout(timeoutId);

    let processedCount = 0;
    let errors = [];

    // Process each mention with time checks
    if (mentions.data?.data) {
      for (const tweet of mentions.data.data) {
        // Check if we've exceeded max execution time
        if (Date.now() - startTime > maxExecutionTime) {
          console.log('Approaching timeout, stopping processing');
          errors.push('Processing stopped due to timeout - partial results');
          break;
        }

        try {
          // Check if tweet has already been processed
          if (await isTweetProcessed(tweet.id)) {
            console.log(`Skipping already processed tweet: ${tweet.id}`);
            continue;
          }

          // Get the username of the tweet author
          const user = mentions.data.includes?.users?.find(u => u.id === tweet.author_id);
          const username = user?.username || 'unknown_user';

          console.log(`Processing mention from @${username}: ${tweet.text}`);

          // Remove the bot mention from the text for cleaner AI input
          const cleanText = tweet.text.replace(new RegExp(`@${botUsername}\\s*`, 'gi'), '').trim();

          // Check if tweet contains a wallet address
          const walletAddress = extractWalletAddress(cleanText);

          let walletPortfolio = null;
          let walletStrategies = null;

          if (walletAddress) {
            console.log(`Found wallet address: ${walletAddress}`);
            try {
              // Fetch wallet data with timeout
              const walletController = new AbortController();
              const walletTimeoutId = setTimeout(() => walletController.abort(), 8000); // 8s for Aura APIs

              [walletPortfolio, walletStrategies] = await Promise.all([
                fetchWalletPortfolio(walletAddress, walletController.signal),
                fetchWalletStrategies(walletAddress, walletController.signal)
              ]);
              clearTimeout(walletTimeoutId);
              console.log(`Fetched wallet data for ${walletAddress}`);
            } catch (error) {
              console.error(`Error fetching wallet data:`, error);
              errors.push(`Wallet fetch failed for ${walletAddress}: ${error.message}`);
              // Continue without wallet data
            }
          }

          // Generate AI response with timeout
          const aiController = new AbortController();
          const aiTimeoutId = setTimeout(() => aiController.abort(), 8000); // 8s for Groq API

          const aiReply = await generateGroqResponse(username, cleanText, walletAddress, walletPortfolio, walletStrategies, aiController.signal);
          clearTimeout(aiTimeoutId);

          // Post reply to Twitter with timeout
          const replyController = new AbortController();
          const replyTimeoutId = setTimeout(() => replyController.abort(), 5000); // 5s for Twitter reply

          await postTwitterReply(tweet.id, aiReply, replyController.signal);
          clearTimeout(replyTimeoutId);

          // Mark tweet as processed
          await addProcessedTweet(tweet.id, username, tweet.text);

          processedCount++;
          console.log(`Successfully replied to @${username} with: ${aiReply}`);
        } catch (error) {
          console.error(`Error processing mention ${tweet.id}:`, error);
          errors.push(`Failed to process tweet ${tweet.id}: ${error.message}`);
        }
      }
    }

    const executionTime = Date.now() - startTime;
    const response = {
      status: errors.length > 0 && processedCount === 0 ? 'partial_success' : 'success',
      message: `Processed ${processedCount} new mentions in ${executionTime}ms`,
      stats: await getProcessingStats(),
      execution_time_ms: executionTime,
      errors: errors.length > 0 ? errors : undefined
    };

    return res.status(200).json(response);

  } catch (error) {
    const executionTime = Date.now() - startTime;
    console.error('Error checking mentions:', error);
    return res.status(500).json({
      status: 'error',
      message: `Function error after ${executionTime}ms: ${error.message}`,
      execution_time_ms: executionTime,
      suggestion: 'Check logs for details or try again later'
    });
  }
}

// Detect wallet address in tweet text
function extractWalletAddress(text) {
  // Regex for Ethereum-style addresses (0x followed by 40 hex chars)
  const walletRegex = /0x[a-fA-F0-9]{40}/g;
  const matches = text.match(walletRegex);
  return matches ? matches[0] : null;
}

// Fetch wallet portfolio data from Aura API
async function fetchWalletPortfolio(address, signal = null) {
  const AURA_BASE_URL = process.env.AURA_BASE_URL || 'https://aura.adex.network';

  const fetchOptions = {
    headers: {
      'Content-Type': 'application/json'
    }
  };

  if (signal) {
    fetchOptions.signal = signal;
  }

  const response = await fetch(`${AURA_BASE_URL}/api/portfolio/balances?address=${address}`, fetchOptions);

  if (!response.ok) {
    throw new Error(`Aura API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

// Fetch wallet strategies from Aura API
async function fetchWalletStrategies(address, signal = null) {
  const AURA_BASE_URL = process.env.AURA_BASE_URL || 'https://aura.adex.network';

  const fetchOptions = {
    headers: {
      'Content-Type': 'application/json'
    }
  };

  if (signal) {
    fetchOptions.signal = signal;
  }

  const response = await fetch(`${AURA_BASE_URL}/api/portfolio/strategies?address=${address}`, fetchOptions);

  if (!response.ok) {
    throw new Error(`Aura API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}