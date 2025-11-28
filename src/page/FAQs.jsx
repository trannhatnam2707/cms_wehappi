import { useEffect, useState } from 'react';
import { collection, getDocs, addDoc, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Trash2, Plus, Edit, X, MessageCircleQuestion, ChevronLeft, ChevronRight, Filter, RefreshCw } from 'lucide-react'; //  SỬA: Thêm icon RefreshCw
import SearchComponent from '../components/Search.jsx'; 

const FAQs = () => {
  const [faqs, setFaqs] = useState([]);
  
  // --- STATE BỘ LỌC & PHÂN TRANG ---
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState(''); 
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(5); 
  const [syncing, setSyncing] = useState(false); // SỬA: State hiển thị trạng thái đồng bộ

  // State cho Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editingId, setEditingId] = useState(null);
  
  // Form Data
  const [formData, setFormData] = useState({
    question: '',
    answer: '',
    category: 'Chung'
  });

  const CATEGORIES = ["Chung", "Sản phẩm", "Vận chuyển", "Đổi trả", "Thanh toán", "Bảo quản"];

  // 1. Lấy dữ liệu
  const fetchFaqs = async () => {
    try {
      const querySnapshot = await getDocs(collection(db, "faqs"));
      const data = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setFaqs(data);
    } catch (error) {
      console.error("Lỗi lấy FAQs:", error);
    }
  };

  useEffect(() => {
    fetchFaqs();
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedCategory]);

  // SỬA: HÀM GỌI API ĐỒNG BỘ (GỌI VÀO VERCEL FUNCTION)
  const syncToPinecone = async (action, id, data = null) => {
    setSyncing(true);
    try {
        // Gọi đường dẫn /api/sync (Vercel Function)
        await fetch('/api/sync', { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, id, data })
        });
    } catch (error) {
        console.error("Lỗi đồng bộ Pinecone:", error);
    } finally {
        setSyncing(false);
    }
  }

  // 3. Xử lý Form (CÓ GỌI SYNC)
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.question || !formData.answer) return alert("Vui lòng nhập đủ thông tin!");

    try {
      let docId = editingId;
      if (editMode) {
        await updateDoc(doc(db, "faqs", editingId), { ...formData });
        // SỬA: Gọi đồng bộ Sửa
        syncToPinecone('UPSERT', docId, formData);
        alert("Đã cập nhật và đang đồng bộ AI!");
      } else {
        const docRef = await addDoc(collection(db, "faqs"), { ...formData, createdAt: new Date() });
        docId = docRef.id;
        // SỬA: Gọi đồng bộ Thêm mới
        syncToPinecone('UPSERT', docId, formData);
        alert("Đã thêm mới và đang đồng bộ AI!");
      }
      closeModal();
      fetchFaqs();
    } catch (error) {
      alert("Lỗi: " + error.message);
    }
  };

  const handleDelete = async (id) => {
    if (window.confirm('Chắc chắn xóa câu hỏi này?')) {
      await deleteDoc(doc(db, "faqs", id));
      // SỬA: Gọi đồng bộ Xóa
      syncToPinecone('DELETE', id);
      fetchFaqs();
    }
  };

  // Modal Helpers
  const openAddModal = () => {
    setEditMode(false); setEditingId(null);
    setFormData({ question: '', answer: '', category: 'Chung' });
    setIsModalOpen(true);
  };

  const openEditModal = (item) => {
    setEditMode(true); setEditingId(item.id);
    setFormData({ question: item.question, answer: item.answer, category: item.category || 'Chung' });
    setIsModalOpen(true);
  };

  const closeModal = () => setIsModalOpen(false);

  // Logic Lọc
  const filteredFaqs = faqs.filter(item => {
    const matchesSearch = item.question.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          item.answer.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === '' ? true : item.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  // Logic Phân trang
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentItems = filteredFaqs.slice(indexOfFirstItem, indexOfLastItem);
  const totalPages = Math.ceil(filteredFaqs.length / itemsPerPage);
  const paginate = (pageNumber) => setCurrentPage(pageNumber);

  return (
    <div>
      {/* HEADER & FILTERS */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
        <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <MessageCircleQuestion className="text-blue-600"/> Quản lý FAQs (Hỏi đáp)
            </h2>
            <span className="bg-blue-100 text-blue-800 text-xs font-medium px-2.5 py-0.5 rounded-full">
                {faqs.length}
            </span>
            {/* SỬA: Hiển thị trạng thái đang đồng bộ */}
            {syncing && <span className="text-xs text-green-600 flex items-center gap-1 ml-2 animate-pulse"><RefreshCw size={12}/> Đang đồng bộ AI...</span>}
        </div>
        
        <div className="flex flex-col md:flex-row gap-3 w-full md:w-auto">
          <SearchComponent 
             keyword={searchTerm}
             onChange={setSearchTerm}
             placeholder="Tìm câu hỏi..."
          />

          <div className="relative min-w-[150px]">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Filter size={18} className="text-gray-400" />
                </div>
                <select 
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none cursor-pointer"
                >
                    <option value="">Tất cả chủ đề</option>
                    {CATEGORIES.map((cat, index) => (
                        <option key={index} value={cat}>{cat}</option>
                    ))}
                </select>
          </div>

          <button onClick={openAddModal} className="bg-blue-600 text-white px-4 py-2.5 rounded-lg hover:bg-blue-700 flex items-center justify-center gap-2 font-medium whitespace-nowrap transition shadow-sm">
            <Plus size={20} /> Thêm mới
          </button>
        </div>
      </div>

      {/* TABLE */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col h-full">
        <div className="overflow-x-auto">
            <table className="w-full text-left text-sm min-w-[800px]">
            <thead className="bg-gray-50 text-gray-600 font-semibold border-b border-gray-200">
                <tr>
                <th className="p-4 whitespace-nowrap w-1/4">Câu hỏi</th>
                <th className="p-4 whitespace-nowrap w-1/2">Câu trả lời</th>
                <th className="p-4 whitespace-nowrap">Danh mục</th>
                <th className="p-4 text-right whitespace-nowrap">Hành động</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
                {currentItems.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50 group align-top transition-colors">
                    <td className="p-4 font-medium text-gray-900">
                        <div className="line-clamp-2 min-w-[200px] max-w-[300px]" title={item.question}>{item.question}</div>
                    </td>
                    <td className="p-4 text-gray-600">
                        <div className="line-clamp-2 min-w-[300px] max-w-[500px]" title={item.answer}>{item.answer}</div>
                    </td>
                    <td className="p-4 whitespace-nowrap">
                        <span className="bg-blue-50 text-blue-700 px-2 py-1 rounded text-xs font-medium border border-blue-100">
                            {item.category}
                        </span>
                    </td>
                    <td className="p-4 text-right whitespace-nowrap">
                        <div className="flex justify-end gap-2">
                            <button onClick={() => openEditModal(item)} className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition"><Edit size={18} /></button>
                            <button onClick={() => handleDelete(item.id)} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"><Trash2 size={18} /></button>
                        </div>
                    </td>
                </tr>
                ))}
            </tbody>
            </table>
        </div>
        
        {/* FOOTER: PHÂN TRANG */}
        {filteredFaqs.length > 0 ? (
            <div className="p-4 border-t border-gray-200 flex flex-col md:flex-row justify-between items-center gap-4 bg-gray-50 mt-auto">
                <span className="text-sm text-gray-500">
                    Hiển thị {indexOfFirstItem + 1} - {Math.min(indexOfLastItem, filteredFaqs.length)} trong tổng số <b>{filteredFaqs.length}</b> câu hỏi
                </span>
                
                <div className="flex items-center gap-2">
                    <button 
                        onClick={() => paginate(currentPage - 1)} 
                        disabled={currentPage === 1}
                        className="p-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition"
                    >
                        <ChevronLeft size={18} />
                    </button>
                    
                    {Array.from({ length: totalPages }, (_, i) => (
                        <button
                            key={i + 1}
                            onClick={() => paginate(i + 1)}
                            className={`w-9 h-9 rounded-lg text-sm font-medium transition
                                ${currentPage === i + 1 
                                ? 'bg-blue-600 text-white shadow-sm' 
                                : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-100'}
                            `}
                        >
                            {i + 1}
                        </button>
                    ))}

                    <button 
                        onClick={() => paginate(currentPage + 1)} 
                        disabled={currentPage === totalPages}
                        className="p-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition"
                    >
                        <ChevronRight size={18} />
                    </button>
                </div>
            </div>
        ) : (
            <div className="p-10 text-center text-gray-500">Chưa có câu hỏi nào khớp với bộ lọc.</div>
        )}
      </div>

      {/* MODAL POPUP */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg animate-fade-in">
            <div className="flex justify-between items-center p-5 border-b">
              <h3 className="text-lg font-bold text-gray-800">{editMode ? 'Sửa câu hỏi' : 'Thêm câu hỏi thường gặp'}</h3>
              <button onClick={closeModal} className="text-gray-400 hover:text-red-500 transition"><X size={24}/></button>
            </div>
            
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Câu hỏi</label>
                    <textarea 
                        value={formData.question} onChange={e => setFormData({...formData, question: e.target.value})}
                        rows="3"
                        className="w-full border p-2.5 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                        placeholder="Ví dụ: Shop có cho đổi trả không?" required
                    />
                </div>
                
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Câu trả lời</label>
                    <textarea 
                        value={formData.answer} onChange={e => setFormData({...formData, answer: e.target.value})}
                        rows="5"
                        className="w-full border p-2.5 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                        placeholder="Ví dụ: Dạ có ạ, trong vòng 7 ngày..." required
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Danh mục</label>
                    <select 
                        value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})}
                        className="w-full border p-2.5 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                    >
                        {CATEGORIES.map((cat, index) => (
                            <option key={index} value={cat}>{cat}</option>
                        ))}
                    </select>
                </div>

                <div className="pt-4 flex gap-3">
                    <button type="button" onClick={closeModal} className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-50 transition">Hủy</button>
                    <button type="submit" className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition">Lưu lại</button>
                </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default FAQs;