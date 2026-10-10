// Waitlist signup endpoint
// Stores emails in Cloudflare KV with rate limiting

export async function onRequestPost(context) {
  const { request, env } = context;
  
  // Get client IP for rate limiting
  const clientIP = request.headers.get('cf-connecting-ip') || 'unknown';
  
  // Rate limit: max 3 submissions per IP per hour
  const rateLimitKey = `ratelimit:${clientIP}`;
  const now = Date.now();
  const hourAgo = now - 3600000;
  
  try {
    // Check existing rate limit data
    const rateDataRaw = await env.WAITLIST_KV.get(rateLimitKey);
    let attempts = [];
    
    if (rateDataRaw) {
      attempts = JSON.parse(rateDataRaw).filter(ts => ts > hourAgo);
    }
    
    if (attempts.length >= 3) {
      return new Response(
        JSON.stringify({ error: 'Too many attempts. Please try again later.' }),
        { status: 429, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    // Parse request body
    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid JSON body' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    const { email } = body;
    
    // Validate email
    if (!email || typeof email !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Email is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return new Response(
        JSON.stringify({ error: 'Invalid email format' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    const normalizedEmail = email.toLowerCase().trim();
    
    // Check if email already exists
    const existing = await env.WAITLIST_KV.get(`email:${normalizedEmail}`);
    if (existing) {
      return new Response(
        JSON.stringify({ message: 'You\'re already on the waitlist!' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    // Store the signup
    const signupData = {
      email: normalizedEmail,
      signedUpAt: new Date().toISOString(),
      ip: clientIP,
      userAgent: request.headers.get('user-agent') || 'unknown',
    };
    
    // Save to KV
    await env.WAITLIST_KV.put(`email:${normalizedEmail}`, JSON.stringify(signupData));
    
    // Update rate limit
    attempts.push(now);
    await env.WAITLIST_KV.put(rateLimitKey, JSON.stringify(attempts), { expirationTtl: 3600 });
    
    // Optional: Send to external service (e.g., Buttondown, Mailchimp, etc.)
    // await sendToEmailService(normalizedEmail);
    
    return new Response(
      JSON.stringify({ success: true, message: 'Added to waitlist' }),
      { status: 201, headers: { 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error('Waitlist error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// Handle OPTIONS for CORS preflight
export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}

// CORS headers for all responses
export async function onRequest(context) {
  const response = await context.next();
  
  response.headers.set('Access-Control-Allow-Origin', '*');
  response.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  
  return response;
}