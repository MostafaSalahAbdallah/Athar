import { BrowserRouter, Routes, Route } from "react-router-dom";
import './App.css'
import Home from '../src/pages/Home'
import Library from '../src/pages/Library'
import Study from '../src/pages/Study'

function App() {

  return (
    <div >
      <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/library" element={<Library />} />
        <Route path="/library/:bookId/:hadithId" element={<Study />} />
        {/* <Route path="/tips" element={} /> //!David */}

        {/* 404 */}
        {/* <Route path="*" element={<NotFound />} /> */}
      </Routes>
    </BrowserRouter>
    </div>
  )
}

export default App
