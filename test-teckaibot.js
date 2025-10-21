// test-teckaibot.js - Test script to trigger the teckaibot endpoint
// Run with: node test-teckaibot.js

import https from 'https';

// Vercel deployment URL (replace with your actual URL)
const vercelUrl = 'https://teckaibot.vercel.app';

// Endpoint to test
const endpoint = '/api/teckaibot';

// Test function to call the PUT endpoint
async function testTeckaiBot() {
  const url = new URL(endpoint, vercelUrl);

  const options = {
    hostname: url.hostname,
    port: 443,
    path: url.pathname,
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      // Add any required headers if needed (e.g., for authentication)
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';

      console.log(`Status: ${res.statusCode}`);
      console.log(`Headers:`, res.headers);

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        console.log('Raw Response Body:', data); // Log raw response for debugging

        if (res.statusCode === 200) {
          try {
            const response = JSON.parse(data);
            console.log('Response:', response);
            resolve(response);
          } catch (error) {
            console.error('Failed to parse response as JSON:', error.message);
            reject(new Error(`Non-JSON response: ${data}`));
          }
        } else {
          // Handle error responses (e.g., 500)
          console.error(`Error Response (${res.statusCode}): ${data}`);
          reject(new Error(`Server error ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', (error) => {
      console.error('Request error:', error);
      reject(error);
    });

    req.end();
  });
}

// Run the test
testTeckaiBot()
  .then((response) => {
    console.log('Test completed successfully:', response);
  })
  .catch((error) => {
    console.error('Test failed:', error.message);
  });
