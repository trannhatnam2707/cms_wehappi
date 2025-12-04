import { GoogleGenerativeAI } from "@google/generative-ai";
import { Pinecone } from "@pinecone-database/pinecone";

const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
const PINECONE_INDEX_NAME = "wehappicms";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ZALO_ACCESS_TOKEN = process.env.ZALO_ACCESS_TOKEN

const pinecone = new Pinecone({apiKey: PINECONE_API_KEY})
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)
const embeddingModel = genAI.getGenerativeModel({model:"text-embedding-004"});
const chatModel = genAI.getGenerativeModel({model:"gemini-2.5-flash"})

async function replyToZalo (userId, text) {
    const url = "https://openapi.zalo.me/v3.0/oa/message/cs"

    const body = {
        recipient: { user_id: userId },
        message: { text: text }
    };
    try {
        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "access_token": ZALO_ACCESS_TOKEN
            },
            body: JSON.stringify(body)
        })
        const data = await res.json();
        console.log("Phản hồi Zalo: ", data)
    }
    catch (error)
    {
        console.error("Lỗi khi gửi tin nhắn zalo :", error);      
    }
}

async function getEmbedding(text) {
  const cleanText = text.replace(/\n/g, " ");
  const result = await embeddingModel.embedContent(cleanText);
  return result.embedding.values;
}


export default async function handler(res, req) {
    if (req.method === "POST")
    {
        const body = req.body;
        console.log("Sự kiện Zalo:", eventData.event_name)
        res.status(200).send("OK");

        // Process user messages (user_send_text)
        const senderId = eventData.sender.id;
        const userMessage = eventData.message.text;
        console.log(`Khách ${senderId} hỏi: ${userMessage}`)

        try {
            // SEARCH INFOR IN PINECONE
            const vector = await getEmbedding(userMessage);
            const index = pinecone.index(PINECONE_INDEX_NAME);
            const queryResponse = await index.query({
                vector: vector,
                topK: 3,
                includeMetadata: true,
            })

            // get context
            const contexts = queryResponse.matches
            .map(match => match.metadata.text_chunk)
            .join("\n\n---\n\n");

            // AI res
            let aiReply = "" ;
            if (!contexts) {
                aiReply =" Dạ em chưa thấy thông tin này. Anh/chị chờ em chút để nhân viên hỗ trợ nhé! ";
            }
            else {
                const prompt = ` Bạn là nhân viên của Wehappi. Trả lời khách dựa trên thông tin: 
                ${contexts} 
                
                Câu hỏi: "${userMessage}"
                Trả lời ngắn , lịch sự
                `;
                const result = await chatModel.generateContent(prompt);
                aiReply = result.response.text();
            }

            // send back zalo
            await replyToZalo(senderId, aiReply);
            }
        catch (error)
        {
            console.error("Lỗi xử lý AI: ", error);
        }
    }
    return res.status(200).send('Zalo Webhook Active');

}
    