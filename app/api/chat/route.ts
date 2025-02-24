import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";

export async function POST(request: Request) {
  const { messages } = await request.json();

  const openai = createOpenAI({
    baseURL: process.env.GAIA_MODEL_BASE_URL,
    apiKey: process.env.GAIA_API_KEY
  });

  try {
    // Simple version without tools
    const result = streamText({
      model: openai("llama"),
      system: "You are a helpful assistant.",
      messages,
    });

    return result.toDataStreamResponse();
  } catch (error) {
    console.error("Error in chat API route:", error);
    // Add more detailed error logging
    console.log("Error details:", JSON.stringify(error, null, 2));
    return new Response("Internal server error", { status: 500 });
  }
}