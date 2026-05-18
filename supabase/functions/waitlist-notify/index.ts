const TO_EMAIL = "rnickerson@realfeygon.com";

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const sharedSecret = Deno.env.get("WAITLIST_WEBHOOK_SECRET");
  const requestSecret = request.headers.get("x-waitlist-webhook-secret");
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const fromEmail = Deno.env.get("WAITLIST_FROM_EMAIL");

  if (!sharedSecret || !resendApiKey || !fromEmail) {
    return new Response("Email provider is not configured", { status: 500 });
  }

  if (requestSecret !== sharedSecret) {
    return new Response("Unauthorized", { status: 401 });
  }

  const payload = await request.json();
  const record = payload.record ?? payload;
  const email = record.email;
  const tag = record.tag ?? "waitlist";

  if (!email || tag !== "waitlist") {
    return new Response("Ignored", { status: 202 });
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromEmail,
      to: TO_EMAIL,
      subject: "SensoryNav waitlist signup",
      text: `New SensoryNav waitlist signup:\n\nEmail: ${email}\nTag: ${tag}`,
    }),
  });

  if (!response.ok) {
    return new Response(await response.text(), { status: 502 });
  }

  return new Response("Sent", { status: 200 });
});
