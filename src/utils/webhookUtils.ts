
export const triggerWebhook = async (data: any) => {
  try {
    const webhookUrl = "https://hooks.zapier.com/hooks/catch/9531377/2j18bjs/";
    
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      mode: "no-cors",
      body: JSON.stringify({
        webhook_url: webhookUrl,
        qualification_data: data,
        timestamp: new Date().toISOString(),
      }),
    });

    return { success: true };
  } catch (error) {
    console.error("Error triggering webhook:", error);
    throw error;
  }
};
