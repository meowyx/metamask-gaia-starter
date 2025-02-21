import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";
import { tools } from "@/ai/tools";

export async function POST(request: Request) {
  const { messages } = await request.json();

  const openai = createOpenAI({
    baseURL: process.env.GAIA_MODEL_BASE_URL,
    apiKey: process.env.GAIA_API_KEY
  });

  try {
    const result = streamText({
      model: openai("llama"),
      system: "you are a friendly assistant",
      messages,
      maxSteps: 5,
      tools,
    });

    return result.toDataStreamResponse();
  } catch (error) {
    console.error(error);
    return new Response("Internal server error", { status: 500 });
  }
}