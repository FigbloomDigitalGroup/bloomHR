interface DeepSeekResponse {
  response: string;
  metadata?: any;
}

export const queryDeepSeek = async (
  prompt: string,
  context: string
): Promise<DeepSeekResponse> => {
  // Use the correct environment variable access method based on your framework
  const apiKey = import.meta.env.VITE_DEEPSEEK_API_KEY; // For Vite
  // OR if using Next.js:
  // const apiKey = process.env.NEXT_PUBLIC_DEEPSEEK_API_KEY;

  if (!apiKey) {
    throw new Error('DeepSeek API key is not configured');
  }

  const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        {
          role: 'system',
          content: `You are an HR assistant. Analyze this HR data and respond helpfully: ${context}`
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.7
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || 'DeepSeek API request failed');
  }

  const data = await response.json();
  return {
    response: data.choices[0].message.content,
    metadata: data.usage
  };
};