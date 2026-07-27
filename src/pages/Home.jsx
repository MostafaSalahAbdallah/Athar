import { IoMdMic } from "react-icons/io"; 
import User from "../components/User";
import Sidebar from "../components/Sidebar";
import logo from '../assets/logo.png' //! Should come from backend!!!
import user from '../assets/user.png'   //! Should come from backend!!!
import Button from "../components/Button";
import Gender from "../components/Gender";
import Age from "../components/Age";
import Card from "../components/Card";
import Password from "../components/Password";
let userName = "مصطفى صلاح" //! Should come from backend!!!
function Home(){
    return(
        <div>
            <Sidebar logo={logo} user={user} userName={userName} />
            
        </div>
    )
}
export default Home;