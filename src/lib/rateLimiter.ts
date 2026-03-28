
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 90000; // 90 seconds between requests

export async function rateLimitRequest<T>(requestFn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    const delay = MIN_REQUEST_INTERVAL - timeSinceLastRequest;
    console.log(`Rate limiting request. Delaying for ${delay}ms`);
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  
  lastRequestTime = Date.now();
  return requestFn();
}
