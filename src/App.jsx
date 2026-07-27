import { BrowserRouter, Routes, Route } from "react-router-dom";
import './App.css'
import Home from '../src/pages/Home'
import Library from '../src/pages/Library'
function App() {

  return (
    <div >
      <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/library" element={<Library />} />
        {/* <Route path="/tips" element={} /> //!David
        <Route path="/library/:id" element={} />
        <Route path="/hadith/:id" element={} /> */}

        {/* 404 */}
        {/* <Route path="*" element={<NotFound />} /> */}
      </Routes>
    </BrowserRouter>
    </div>
  )
}

export default App
