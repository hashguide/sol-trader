export async function deliverAlert(input: {
  title: string;
  body: string;
  level: "info" | "trade" | "error" | "kill";
  webhook: string | null;
  fetchImpl?: typeof fetch;
}): Promise<boolean> {
  const fetchFn = input.fetchImpl ?? fetch;
  let delivered = false;
  const text = `${input.title}\n${input.body}`;
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chat = process.env.TELEGRAM_CHAT_ID?.trim();
  if (token && chat) {
    const res = await fetchFn(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text }),
    });
    delivered = res.ok || delivered;
  }
  if (input.webhook) {
    const discord = input.webhook.includes("discord.com");
    const res = await fetchFn(input.webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(discord ? { content: text } : { title: input.title, text, level: input.level }),
    });
    delivered = res.ok || delivered;
  }
  return delivered;
}
