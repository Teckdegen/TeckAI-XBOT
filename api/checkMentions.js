import { TwitterApi } from 'twitter-api-v2';
import { generateGroqResponse } from '../utils/twitter.js';
import { postTwitterReply } from '../utils/twitter.js';
import { addProcessedTweet, isTweetProcessed, getProcessingStats } from '../utils/stateManager.js';

// Vercel serverless function to check mentions
export default async function handler(req, res) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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
    
    // Search for recent mentions of the bot
    const searchParams = {
      max_results: 10,
      'tweet.fields': ['id', 'text', 'author_id', 'created_at'],
      'user.fields': ['username', 'name'],
      expansions: ['author_id']
    };
    
    const mentions = await readOnlyClient.v2.search(`@${botUsername} -is:retweet`, searchParams);

    let processedCount = 0;
    
    // Process each mention
    if (mentions.data?.data) {
      for (const tweet of mentions.data.data) {
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
              // Fetch wallet data from Aura APIs
              [walletPortfolio, walletStrategies] = await Promise.all([
                fetchWalletPortfolio(walletAddress),
                fetchWalletStrategies(walletAddress)
              ]);
              console.log(`Fetched wallet data for ${walletAddress}`);
            } catch (error) {
              console.error(`Error fetching wallet data:`, error);
              // Continue without wallet data
            }
          }

          // Generate AI response using Groq
          const aiReply = await generateGroqResponse(username, cleanText, walletAddress, walletPortfolio, walletStrategies);

          // Post reply to Twitter
          await postTwitterReply(tweet.id, aiReply);

          // Mark tweet as processed
          await addProcessedTweet(tweet.id, username, tweet.text);

          processedCount++;
          console.log(`Successfully replied to @${username} with: ${aiReply}`);
        } catch (error) {
          console.error(`Error processing mention ${tweet.id}:`, error);
        }
      }
    }

    return res.status(200).json({ 
      status: 'success',
      message: `Processed ${processedCount} new mentions`,
      stats: await getProcessingStats()
    });

  } catch (error) {
    console.error('Error checking mentions:', error);
    return res.status(500).json({ 
      status: 'error',
      message: error.message 
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
async function fetchWalletPortfolio(address) {
  const AURA_BASE_URL = process.env.AURA_BASE_URL || 'https://aura.adex.network';

  const response = await fetch(`${AURA_BASE_URL}/api/portfolio/balances?address=${address}`, {
    headers: {
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`Aura API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

// Fetch wallet strategies from Aura API
async function fetchWalletStrategies(address) {
  const AURA_BASE_URL = process.env.AURA_BASE_URL || 'https://aura.adex.network';

  const response = await fetch(`${AURA_BASE_URL}/api/portfolio/strategies?address=${address}`, {
    headers: {
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`Aura API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}