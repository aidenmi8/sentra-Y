import { NextResponse } from 'next/server';
import crypto from 'crypto';

export async function POST(request: Request) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET?.trim();
  const forwardUrl = process.env.GITHUB_WEBHOOK_FORWARD_URL?.trim();

  if (!secret || !forwardUrl) {
    return NextResponse.json(
      { error: 'GitHub webhook bridge not configured' },
      { status: 503 },
    );
  }

  let parsedForwardUrl: URL;
  try {
    parsedForwardUrl = new URL(forwardUrl);
    if (parsedForwardUrl.protocol !== 'http:' && parsedForwardUrl.protocol !== 'https:') {
      throw new Error('Unsupported protocol');
    }
  } catch {
    return NextResponse.json(
      { error: 'GitHub webhook bridge not configured' },
      { status: 503 },
    );
  }

  try {
    const payloadText = await request.text();
    const signature = request.headers.get('x-hub-signature-256');

    if (!signature) {
      return NextResponse.json({ error: 'Unauthorized: Missing signature' }, { status: 401 });
    }

    const hmac = crypto.createHmac('sha256', secret);
    const digest = `sha256=${hmac.update(payloadText).digest('hex')}`;

    try {
      if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest))) {
        return NextResponse.json({ error: 'Unauthorized: Invalid signature' }, { status: 401 });
      }
    } catch {
      return NextResponse.json({ error: 'Unauthorized: Invalid signature format' }, { status: 401 });
    }

    JSON.parse(payloadText);

    const response = await fetch(parsedForwardUrl.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hub-signature-256': signature,
      },
      body: payloadText,
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      console.error('Failed to forward GitHub webhook:', response.statusText);
      return NextResponse.json({ error: 'Failed to forward webhook' }, { status: 502 });
    }

    return NextResponse.json({ success: true, message: 'Webhook forwarded successfully' }, { status: 200 });
  } catch (error) {
    console.error('Error handling GitHub webhook:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
