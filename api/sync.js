import { Pinecone } from '@pinecone-database/pinecone';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Lấy key từ biến môi trường của Vercel
const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
const PINECONE_INDEX_NAME = "wehappicms"; 
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

console.log("🔍 DEBUG KEY:", {
    Pinecone: PINECONE_API_KEY ? "Đã có (" + PINECONE_API_KEY.substring(0, 5) + "...)" : "❌ RỖNG",
    Gemini: GEMINI_API_KEY ? "Đã có" : "❌ RỖNG"
});

// Khởi tạo SDK
const pinecone = new Pinecone({ apiKey: PINECONE_API_KEY });
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });

// Hàm cắt nhỏ văn bản (Chunking)
function splitTextIntoChunks(text, chunkSize = 1000, overlap = 200) {
  if (!text || text.length <= chunkSize) return [text];
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + chunkSize, text.length);
    if (end < text.length) {
        const lastSpace = text.lastIndexOf(' ', end);
        if (lastSpace > start) end = lastSpace;
    }
    chunks.push(text.slice(start, end).trim());
    start = end - overlap;
    if (start >= end) start = end;
  }
  return chunks;
}

// --- HÀM XỬ LÝ CHÍNH (HANDLER) ---
export default async function handler(req, res) {
  // 1. Cấu hình CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { action, id, data } = req.body;
  console.log(`📩 Vercel Function: Nhận lệnh ${action} cho ID: ${id}`);

  try {
    const index = pinecone.index(PINECONE_INDEX_NAME);

    // A. XÓA DỮ LIỆU CŨ (Quan trọng: Dùng deleteMany với Filter)
    // Bất kể là DELETE hay UPSERT, ta đều xóa sạch dữ liệu cũ của ID này trước để tránh rác
    if (action === 'DELETE' || action === 'UPSERT') {
        try {
            console.log(`🗑️ Đang xóa các vector cũ của ID: ${id}...`);
            
            // Cách 1: Xóa theo metadata (Chuẩn nhất cho Pinecone Serverless)
            await index.deleteMany({
                filter: { original_id: { $eq: id } }
            });

        } catch(e) {
            console.log("⚠️ Lỗi xóa bằng filter (thử cách thủ công):", e.message);
            
            // Cách 2: (Backup) Xóa thủ công các chunk ID dự đoán (nếu gói Free cũ bị lỗi filter)
            // Xóa vector gốc và các chunk phổ biến (từ #0 đến #5)
            try {
                const idsToDelete = [id];
                for(let i=0; i<6; i++) idsToDelete.push(`${id}#${i}`);
                await index.deleteMany(idsToDelete);
            } catch (err2) {}
        }
    }

    // Nếu lệnh là DELETE thì dừng tại đây
    if (action === 'DELETE') {
        return res.status(200).json({ success: true, message: "Đã xóa thành công trên Pinecone" });
    }

    // B. THÊM MỚI / SỬA (UPSERT)
    if (action === 'UPSERT' && data) {
        const fullContent = `Câu hỏi: ${data.question}\nCâu trả lời: ${data.answer}\nDanh mục: ${data.category}`;
        const chunks = splitTextIntoChunks(fullContent);
        
        const vectors = [];
        for (let i = 0; i < chunks.length; i++) {
            const chunkText = chunks[i];
            const cleanText = chunkText.replace(/\n/g, " ");
            const result = await embeddingModel.embedContent(cleanText);
            const vector = result.embedding.values;

            vectors.push({
                id: `${id}#${i}`, // ID chunk: faq_123#0
                values: vector,
                metadata: {
                    original_id: id,
                    text_chunk: chunkText,
                    category: data.category,
                    question: data.question
                }
            });
        }

        if (vectors.length > 0) {
            await index.upsert(vectors);
        }
        return res.status(200).json({ success: true, message: `Đã đồng bộ ${vectors.length} chunks` });
    }

    return res.status(400).json({ error: "Action không hợp lệ" });

  } catch (error) {
    console.error("Lỗi Serverless Function:", error);
    return res.status(500).json({ error: error.message });
  }
}