const crypto = require('crypto');

// Twitter handler for Vercel serverless function (legacy webhook support)
module.exports = async (req, res) => {
  try {
    // Handle CRC check for GET requests (Twitter validation) - Legacy webhook support
    if (req.method === 'GET') {
      const crcToken = req.query.crc_token;
      if (!crcToken) {
        return res.status(400).json({ error: 'Missing crc_token' });
      }

      const TWITTER_CONSUMER_SECRET = process.env.TWITTER_APP_SECRET;

      if (!TWITTER_CONSUMER_SECRET) {
        return res.status(500).json({ error: 'TWITTER_APP_SECRET not set' });
      }

      // Create HMAC-SHA256 hash using consumer secret
      const hmac = crypto.createHmac('sha256', TWITTER_CONSUMER_SECRET)
                       .update(crcToken)
                       .digest('base64');

      const responseToken = `sha256=${hmac}`;

      return res.status(200).json({
        response_token: responseToken
      });
    }

    // Handle webhook events for POST requests - Legacy webhook support
    if (req.method === 'POST') {
      try {
        const body = req.body;

        // Log the incoming webhook for debugging
        console.log('Received webhook:', JSON.stringify(body, null, 2));

        // Check if this is a mention/tweet event
        if (body.tweet_create_events || body.direct_message_events) {
          await handleMentionEvent(body);
        }

        // Always return 200 to prevent Twitter retries
        return res.status(200).json({ status: 'ok' });

      } catch (error) {
        console.error('Webhook error:', error);
        // Still return 200 to prevent retries
        return res.status(200).json({ status: 'error', message: error.message });
      }
    }

    // New endpoint for manual trigger of mention checking
    if (req.method === 'PUT') {
      try {
        console.log('PUT request received for manual mention check');

        // Check if required environment variables are set
        const requiredEnvVars = ['TWITTER_BEARER_TOKEN', 'BOT_USERNAME', 'GROQ_API_KEY'];
        for (const envVar of requiredEnvVars) {
          if (!process.env[envVar]) {
            throw new Error(`Environment variable ${envVar} is not set`);
          }
        }

        // Import and run the mention checking function
        const { default: checkMentions } = await import('./checkMentions.js');
        await checkMentions(req, res);
      } catch (error) {
        console.error('Manual check error:', error);
        let statusCode = 500;
        let suggestion = 'Check logs and environment variables';

        if (error.message.includes('rate limit') || error.message.includes('429')) {
          statusCode = 429;
          suggestion = 'API rate limit exceeded. Wait or upgrade your plan.';
        } else if (error.message.includes('401') || error.message.includes('Unauthorized')) {
          suggestion = 'Check API keys and permissions.';
        }

        return res.status(statusCode).json({
          status: 'error',
          message: `Manual check failed: ${error.message}`,
          suggestion,
          error_code: error.code || 'UNKNOWN'
        });
      }
      return;
    }

    // Method not allowed
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Unhandled error in teckaibot handler:', error);
    return res.status(500).json({
      status: 'error',
      message: `Internal server error: ${error.message}`,
      suggestion: 'Contact support or check logs'
    });
  }
};

// Handle mention events (legacy webhook approach)
async function handleMentionEvent(eventData) {
  const tweetEvents = eventData.tweet_create_events || [];

  for (const tweet of tweetEvents) {
    // Skip if it's a retweet or if the bot mentions itself
    if (tweet.retweeted_status || isSelfMention(tweet)) {
      continue;
    }

    // Check if the bot is mentioned
    const botUsername = process.env.BOT_USERNAME;
    if (!tweet.entities?.user_mentions?.some(mention => mention.screen_name === botUsername)) {
      continue;
    }

    // Extract mention details
    const tweetId = tweet.id_str;
    const username = tweet.user.screen_name;
    const tweetText = tweet.text;

    // Remove the bot mention from the text for cleaner AI input
    const cleanText = tweetText.replace(new RegExp(`@${botUsername}\\s*`, 'gi'), '').trim();

    console.log(`Processing mention from @${username}: ${cleanText}`);

    try {
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
      await postTwitterReply(tweetId, aiReply);

      console.log(`Successfully replied to @${username} with: ${aiReply}`);

    } catch (error) {
      console.error(`Error processing mention from @${username}:`, error);
    }
  }
}

// Check if this is a self-mention (bot replying to itself)
function isSelfMention(tweet) {
  const botUsername = process.env.BOT_USERNAME;
  return tweet.user?.screen_name === botUsername;
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
  const AURA_API_KEY = process.env.AURA_API_KEY;
  const AURA_BASE_URL = process.env.AURA_BASE_URL || 'https://aura.adex.network';

  const response = await fetch(`${AURA_BASE_URL}/api/portfolio/balances?address=${address}`, {
    headers: {
      'Authorization': `Bearer ${AURA_API_KEY}`,
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
  const AURA_API_KEY = process.env.AURA_API_KEY;
  const AURA_BASE_URL = process.env.AURA_BASE_URL || 'https://aura.adex.network';

  const response = await fetch(`${AURA_BASE_URL}/api/portfolio/strategies?address=${address}`, {
    headers: {
      'Authorization': `Bearer ${AURA_API_KEY}`,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`Aura API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

// Generate response using Groq AI
async function generateGroqResponse(username, tweetText, walletAddress, walletPortfolio, walletStrategies) {
  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${GROQ_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        {
          role: "system",
          content: `You are a witty, kind, and helpful AI bot on Twitter.
Reply to mentions in a way that's short, engaging, and contextually relevant.
Keep responses under 280 characters. Be friendly and add value instead of repeating the original tweet.
Never use hashtags or mention other users unless specifically asked.`
        },
        {
          role: "user",
          content: `@${username}: ${tweetText}`
        }
      ],
      max_tokens: 100,
      temperature: 0.7
    })
  });

  if (!response.ok) {
    throw new Error(`Groq API error: ${response.status} ${response.statusText}`);
  }

  const result = await response.json();
  return result.choices[0]?.message?.content?.trim() || "Sorry, I couldn't generate a response right now! 🤖";
}

// Post reply to Twitter using API v1.1 (statuses/update)
async function postTwitterReply(tweetId, replyText) {
  const TWITTER_ACCESS_TOKEN = process.env.TWITTER_ACCESS_TOKEN;
  const TWITTER_ACCESS_SECRET = process.env.TWITTER_ACCESS_SECRET;
  const TWITTER_APP_KEY = process.env.TWITTER_APP_KEY;
  const TWITTER_APP_SECRET = process.env.TWITTER_APP_SECRET;

  // Create OAuth signature for Twitter API v1.1
  const oauthParams = {
    oauth_consumer_key: TWITTER_APP_KEY,
    oauth_token: TWITTER_ACCESS_TOKEN,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000),
    oauth_nonce: crypto.randomBytes(16).toString('base64').replace(/[^a-zA-Z0-9]/g, ''),
    oauth_version: '1.0',
    status: replyText,
    in_reply_to_status_id: tweetId,
    auto_populate_reply_metadata: 'true'
  };

  // Create signature base string
  const paramString = Object.keys(oauthParams)
    .sort()
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(oauthParams[key])}`)
    .join('&');

  const signatureBaseString = `POST&${encodeURIComponent('https://api.twitter.com/1.1/statuses/update.json')}&${encodeURIComponent(paramString)}`;

  // Create signing key
  const signingKey = `${encodeURIComponent(TWITTER_APP_SECRET)}&${encodeURIComponent(TWITTER_ACCESS_SECRET)}`;

  // Generate signature
  const signature = crypto.createHmac('sha1', signingKey)
                        .update(signatureBaseString)
                        .digest('base64');

  oauthParams.oauth_signature = signature;

  // Create authorization header
  const authHeader = 'OAuth ' + Object.keys(oauthParams)
    .filter(key => key.startsWith('oauth_'))
    .map(key => `${encodeURIComponent(key)}="${encodeURIComponent(oauthParams[key])}"`)
    .join(', ');

  const response = await fetch('https://api.twitter.com/1.1/statuses/update.json', {
    method: 'POST',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      status: replyText,
      in_reply_to_status_id: tweetId,
      auto_populate_reply_metadata: 'true'
    })
  });

  if (!response.ok) {
    const errorData = await response.text();
    throw new Error(`Twitter API error: ${response.status} ${response.statusText} - ${errorData}`);
  }

  return response.json();
}