import { NextResponse } from 'next/server';
import { Pinecone } from '@pinecone-database/pinecone';
import axios from 'axios';
import 'dotenv/config';

const systemPrompt = `
You are a rate my professor agent to help students find classes, that takes in user questions and answers them.
For every user question, the top 3 professors that match the user question are returned.
Use them to answer the question if needed.
`;

export async function POST(req) {
    const data = await req.json();
    const pc = new Pinecone({
        apiKey: process.env.PINECONE_API_KEY,
    });
    const index = pc.index('rag').namespace('ns1');

    const text = data[data.length - 1].content;

    try {
        const modelName = 'sentence-transformers/all-MiniLM-L6-v2'; // Model for sentence embeddings

        const response = await axios.post(
            `https://api-inference.huggingface.co/models/${modelName}`,
            { inputs: text },
            {
                headers: {
                    Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
                    'Content-Type': 'application/json',
                },
            }
        );

        // Extract embedding from response
        const embedding = response.data[0]?.embedding;

        if (!embedding) {
            throw new Error('No embedding returned from Hugging Face API');
        }

        // Query Pinecone with the embedding
        const results = await index.query({
            topK: 5,
            includeMetadata: true,
            vector: embedding,
        });

        let resultString = '';
        results.matches.forEach((match) => {
            resultString += `
            Returned Results:
            Professor: ${match.id}
            Review: ${match.metadata.review}
            Subject: ${match.metadata.subject}
            Stars: ${match.metadata.stars}
            \n\n`;
        });

        const lastMessage = data[data.length - 1];
        const lastMessageContent = lastMessage.content + resultString;
        const lastDataWithoutLastMessage = data.slice(0, data.length - 1);

        // Assuming you're using OpenRouter for text generation
        const completion = await openai.chat.completions.create({
            messages: [
                { role: 'system', content: systemPrompt },
                ...lastDataWithoutLastMessage,
                { role: 'user', content: lastMessageContent },
            ],
            model: 'meta-llama/llama-3-70b-instruct',
            stream: true,
        });

        const stream = new ReadableStream({
            async start(controller) {
                const encoder = new TextEncoder();
                try {
                    for await (const chunk of completion) {
                        const content = chunk.choices[0]?.delta?.content;
                        if (content) {
                            const text = encoder.encode(content);
                            controller.enqueue(text);
                        }
                    }
                } catch (err) {
                    controller.error(err);
                } finally {
                    controller.close();
                }
            },
        });

        return new NextResponse(stream);

    } catch (error) {
        console.error('Error fetching embeddings:', error);
        console.error('Error details:', error.response?.data || error.message); // Log detailed error
        return new NextResponse('Internal Server Error', { status: 500 });
    }
}
