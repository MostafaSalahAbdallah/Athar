function User(props) {
    return (
        <label
            htmlFor="sidebar-drawer"
            className="drawer-button fixed top-3 right-3 cursor-pointer"
        >
            <div className="avatar avatar-online">
                <div className="w-12 rounded-full ring ring-cyan-700 hover:ring-cyan-700 dark:ring-cyan-400 ring-offset-1 ring-offset-base-100">
                    <img src={props.user} alt="User" />
                    
                </div>
            </div>
            {/* <div className="avatar avatar-placeholder">
                <div className="w-12 rounded-full bg-base-300">
                    +11 Number of notifications
                    
                </div>
            </div> */}
        </label>
    )
}
export default User;