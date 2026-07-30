import { BrowserRouter, Routes, Route } from "react-router-dom";
import './App.css'
import Home from '../src/pages/Home'
function App() {

  return (
    <div >
      <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        {/* <Route path="/tips" element={} /> //!David
        <Route path="/library" element={} /> //! Ashraf
        <Route path="/library/ :id" element={} />
        <Route path="/hadith/:id" element={} /> */}

        {/* 404 */}
        {/* <Route path="*" element={<NotFound />} /> */}
      </Routes>
    </BrowserRouter>
    </div>
  )
}

export default App
