// Draggable title strip that replaces the native OS title bar (hidden via
// titleBarStyle: 'hidden'). On Windows the OS-drawn close/min/max buttons
// appear as a Windows Controls Overlay at the top-right of this strip;
// padding-right leaves that area clear.
export function TitleBar() {
  return (
    <div className="title-bar">
      <span className="title-bar-text">CosmicSSH</span>
    </div>
  )
}
