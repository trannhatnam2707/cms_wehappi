import { Pinecone } from '@pinecone-database/pinecone';
import { GoogleGenerativeAI } from '@google/generative-ai';


const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
const PINECONE_INDEX_NAME = "wehappi-cms"; 
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const FACEBOOK_PAGE_ACCESS_TOKEN = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
const FACEBOOK_VERIFY_TOKEN = process.env.FACEBOOK_VERIFY_TOKEN;

const pinecone = new Pinecone({ apiKey: PINECONE_API_KEY });
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });
const chatModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

// --- HÀM HELPER: Gửi tin nhắn lại cho khách ---
async function sendMessageToUser(recipientId, text) {
  const url = `https://graph.facebook.com/v24.0/me/messages?access_token=${FACEBOOK_PAGE_ACCESS_TOKEN}`;
  
  const body = {
    recipient: { id: recipientId },
    message: { text: text }
  };

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch (error) {
    console.error("Lỗi gửi tin Facebook:", error);
  }
}

// --- HÀM HELPER: Tạo Vector ---
async function getEmbedding(text) {
  const cleanText = text.replace(/\n/g, " ");
  const result = await embeddingModel.embedContent(cleanText);
  return result.embedding.values;
}

// --- HÀM XỬ LÝ CHÍNH (HANDLER) ---
export default async function handler(req, res) {
  
  // 1. XÁC MINH WEBHOOK (Facebook gọi cái này đầu tiên để kiểm tra)
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    // Kiểm tra xem Token có khớp với cái mình tự đặt không
    if (mode === 'subscribe' && token === FACEBOOK_VERIFY_TOKEN) {
      console.log("✅ Facebook Webhook Verified!");
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  }

  // 2. XỬ LÝ TIN NHẮN ĐẾN (POST)
  if (req.method === 'POST') {
    const body = req.body;

    // Kiểm tra xem có phải sự kiện từ Page không
    if (body.object === 'page') {
      
      // Duyệt qua các tin nhắn (có thể nhiều tin cùng lúc)
      for (const entry of body.entry) {
        // Lấy sự kiện đầu tiên
        const webhook_event = entry.messaging ? entry.messaging[0] : null;
        
        if (webhook_event && webhook_event.sender) {
            const senderId = webhook_event.sender.id; // ID khách hàng

            // Chỉ xử lý nếu là tin nhắn văn bản
            if (webhook_event.message && webhook_event.message.text) {
            const userQuestion = webhook_event.message.text;
            console.log(`📩 Khách (${senderId}) hỏi: ${userQuestion}`);

            try {
                const vector = await getEmbedding(userQuestion);

                const index = pinecone.index(PINECONE_INDEX_NAME);
                const queryResponse = await index.query({
                    vector: vector,
                    topK: 3,
                    includeMetadata: true,
                });

                const contexts = queryResponse.matches
                .map(match => match.metadata.text_chunk)
                .join("\n\n---\n\n");

                const systemPrompt = `
                Bạn là nhân viên tư vấn của WeHappi Shop.
                Dựa vào thông tin sau để trả lời khách hàng ngắn gọn, thân thiện:
                ${contexts}

                KHÁCH HỎI: "${userQuestion}"
                `;

                const result = await chatModel.generateContent(systemPrompt);
                const aiResponse = result.response.text();

                await sendMessageToUser(senderId, aiResponse);

            } catch (error) {
                console.error("Lỗi xử lý AI:", error);
                await sendMessageToUser(senderId, "Dạ hiện tại hệ thống em đang bận xíu, anh/chị chờ lát nhé!");
            }
            }
        }
      }

      return res.status(200).send('EVENT_RECEIVED');
    }
    return res.status(404).send('Not Found');
  }
}