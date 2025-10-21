import { TwitterApi } from 'twitter-api-v2';
import crypto from 'crypto';

/**
 * Generate response using Groq AI
 * @param {string} username - Twitter username
 * @param {string} tweetText - Text of the tweet
 * @param {string|null} walletAddress - Wallet address if found in tweet
 * @param {object|null} walletPortfolio - Portfolio data from Aura API
 * @param {object|null} walletStrategies - Strategy data from Aura API
 * @returns {Promise<string>} - Generated response
 */
export async function generateGroqResponse(username, tweetText, walletAddress = null, walletPortfolio = null, walletStrategies = null) {
  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';

  // Clean the tweet text by removing the bot mention
  const botUsername = process.env.BOT_USERNAME;
  const cleanText = tweetText.replace(new RegExp(`@${botUsername}\\s*`, 'gi'), '').trim();

  let systemPrompt = `You are a witty, kind, and helpful AI bot on Twitter.
Reply to mentions in a way that's short, engaging, and contextually relevant.
Keep responses under 280 characters. Be friendly and add value instead of repeating the original tweet.
Always mention the user in your reply using @${username}.
Never use hashtags or mention other users unless specifically asked.`;

  // Add wallet context to the prompt if available
  if (walletAddress && walletPortfolio && walletStrategies) {
    systemPrompt += `
The user mentioned a wallet address. You have access to their portfolio data and investment strategies.
Provide insights based on this information in your response.`;
  }

  const userPrompt = `@${username}: ${cleanText}`;

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
          content: systemPrompt
        },
        {
          role: "user",
          content: userPrompt
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
  // Ensure we mention the user in the reply
  let reply = result.choices[0]?.message?.content?.trim() || "Sorry, I couldn't generate a response right now! 🤖";
  
  // Make sure the reply mentions the user
  if (!reply.includes(`@${username}`)) {
    reply = `@${username} ${reply}`;
  }
  
  return reply.substring(0, 280); // Ensure it's under 280 characters
}

/**
 * Post reply to Twitter using API v1.1 (statuses/update)
 * @param {string} tweetId - ID of the tweet to reply to
 * @param {string} replyText - Text of the reply
 * @returns {Promise<object>} - Response from Twitter API
 */
export async function postTwitterReply(tweetId, replyText) {
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