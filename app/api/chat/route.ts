import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";
import { tools } from "@/ai/tools";

export async function POST(request: Request) {
  const { messages } = await request.json();

  const openai = createOpenAI({
    baseURL: 'https://llama8b.gaia.domains/v1',
    apiKey: 'GAIA'
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
