export const config = {
  runtime: "nodejs"
};

import { Pinecone } from '@pinecone-database/pinecone';
import { GoogleGenerativeAI } from '@google/generative-ai';

// --- CẤU HÌNH ---
const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
const PINECONE_INDEX_NAME = "wehappicms"; // Tên Index của bạn
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ZALO_ACCESS_TOKEN = process.env.ZALO_ACCESS_TOKEN; // Token OA Zalo

// Khởi tạo SDK
const pinecone = new Pinecone({ apiKey: PINECONE_API_KEY });
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });
const chatModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

// --- HÀM HELPER: Tạo Vector ---
async function getEmbedding(text) {
  const cleanText = text.replace(/\n/g, " ");
  const result = await embeddingModel.embedContent(cleanText);
  return result.embedding.values;
}

// --- HÀM HELPER: Gửi tin nhắn lại Zalo OA ---
async function replyToZalo(userId, text) {
  const url = "https://openapi.zalo.me/v3.0/oa/message/cs"; // API tin tư vấn
  
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
    });
    
    const data = await res.json();
    console.log("Phản hồi Zalo:", data);
  } catch (error) {
    console.error("Lỗi gửi tin Zalo:", error);
  }
}

// --- HÀM XỬ LÝ CHÍNH (Vercel Handler) ---
export default async function handler(req, res) {
  // Zalo Webhook gửi sự kiện qua method POST
  if (req.method === 'POST') {
    const eventData = req.body;
    console.log("Sự kiện Zalo:", eventData.event_name);

    // Phản hồi 200 OK ngay lập tức để Zalo không gửi lại (Retry)
    res.status(200).send('OK');

    // Xử lý tin nhắn người dùng (user_send_text)
    if (eventData.event_name === "user_send_text") {
      const senderId = eventData.sender.id;
      const userMessage = eventData.message.text;
      console.log(`Khách ${senderId} hỏi: ${userMessage}`);

      try {
        // 1. Tìm kiếm thông tin trong Pinecone
        const vector = await getEmbedding(userMessage);
        const index = pinecone.index(PINECONE_INDEX_NAME);
        const queryResponse = await index.query({
          vector: vector,
          topK: 3,
          includeMetadata: true,
        });

        // 2. Lấy bối cảnh
        const contexts = queryResponse.matches
          .map(match => match.metadata.text_chunk)
          .join("\n\n---\n\n");

        // 3. AI trả lời
        let aiReply = "";
        if (!contexts) {
          aiReply = "Dạ em chưa tìm thấy thông tin này. Anh/chị chờ chút để nhân viên hỗ trợ nhé!";
        } else {
          const prompt = `
            Bạn là nhân viên shop WeHappi. Trả lời khách dựa trên thông tin:
            ${contexts}
            
            Câu hỏi: "${userMessage}"
            Trả lời ngắn gọn, lịch sự.
          `;
          const result = await chatModel.generateContent(prompt);
          aiReply = result.response.text();
        }

        // 4. Gửi lại Zalo (Chạy ngầm sau khi đã res.200)
        await replyToZalo(senderId, aiReply);

      } catch (error) {
        console.error("Lỗi xử lý AI:", error);
      }
    }
    return;
  }

  // Zalo thỉnh thoảng gọi GET để verify (ít gặp nhưng cứ để)
  return res.status(200).send('Zalo Webhook Active');
}