import { Pinecone } from '@pinecone-database/pinecone';
import { GoogleGenerativeAI } from '@google/generative-ai';

// --- CẤU HÌNH ---
const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
const PINECONE_INDEX_NAME = "wehappicms"; 
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ZALO_ACCESS_TOKEN = process.env.ZALO_ACCESS_TOKEN;

// Khởi tạo SDK
const pinecone = new Pinecone({ apiKey: PINECONE_API_KEY });
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });
const chatModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// --- HÀM HELPER: Tạo Vector ---
async function getEmbedding(text) {
  try {
    const cleanText = text.replace(/\n/g, " ");
    const result = await embeddingModel.embedContent(cleanText);
    return result.embedding.values;
  } catch (error) {
    console.error("Lỗi Embedding:", error);
    return null;
  }
}

// --- HÀM HELPER: Gửi tin nhắn lại Zalo OA ---
async function replyToZalo(userId, text) {
  const url = "https://openapi.zalo.me/v3.0/oa/message/cs"; 
  
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

// --- HÀM XỬ LÝ CHÍNH (HANDLER) ---
export default async function handler(req, res) {
  // 1. Trả lời Zalo ngay lập tức (Chống timeout)
  res.statusCode = 200;
  res.end('OK');

  // Chỉ xử lý POST
  if (req.method !== 'POST') return;

  try {
    const eventData = req.body;
    console.log("📩 Sự kiện Zalo:", eventData.event_name);

    // 2. Lọc sự kiện: Chỉ xử lý khi người dùng gửi tin nhắn
    if (eventData.event_name === "user_send_text") {
      const senderId = eventData.sender.id;
      const userMessage = eventData.message.text;
      console.log(`Khách ${senderId} hỏi: ${userMessage}`);

      // --- LOGIC AI (Chạy ngầm sau khi đã response OK) ---
      
      // A. Tạo Vector
      const vector = await getEmbedding(userMessage);
      
      if (vector) {
          // B. Tìm kiếm Pinecone
          const index = pinecone.index(PINECONE_INDEX_NAME);
          const queryResponse = await index.query({
            vector: vector,
            topK: 3,
            includeMetadata: true,
          });

          // C. Lấy bối cảnh
          const contexts = queryResponse.matches
            .filter(match => match.score > 0.60) 
            .map(match => match.metadata.text_chunk)
            .join("\n\n---\n\n");

          // D. AI trả lời
          let aiReply = "";
          if (!contexts) {
            aiReply = "Dạ em chưa tìm thấy thông tin này. Anh/chị chờ chút để nhân viên hỗ trợ nhé!";
          } else {
            const prompt = `
              Bạn là trợ lý ảo WeHappi Shop. Dựa vào thông tin sau để trả lời:
              ${contexts}
              
              Câu hỏi: "${userMessage}"
              Trả lời ngắn gọn, thân thiện.
            `;
            const result = await chatModel.generateContent(prompt);
            aiReply = result.response.text();
          }

          // E. Gửi câu trả lời
          await replyToZalo(senderId, aiReply);
      }
    }
  } catch (error) {
    console.error("Lỗi xử lý Zalo:", error);
  }
}