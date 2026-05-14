import { memo, useEffect, useRef, useState } from 'react'
import { groupProfiles, useProfilesStore } from '../stores/profiles-store'
import type { SessionProfile } from '../../../shared/types'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'
import { ComputerIcon, GlobeIcon } from './icons'
import { InputPrompt } from './InputPrompt'

type MenuState =
  | { kind: 'group'; group: string; x: number; y: number }
  | { kind: 'profile'; profile: SessionProfile; x: number; y: number }
  | { kind: 'empty'; x: number; y: number }
  | null

// Inline rename target. `key` is the group name (including '' for Ungrouped)
// for kind:'group', or the profile id for kind:'profile'.
type RenameTarget =
  | { kind: 'group'; key: string }
  | { kind: 'profile'; key: string }

type Props = {
  onConnect: (profile: SessionProfile) => void
  onEdit: (profile: SessionProfile) => void
  onNewProfile: () => void
  onOpenSettings: () => void
}

function SidebarImpl({ onConnect, onEdit, onNewProfile, onOpenSettings }: Props) {
  const profiles = useProfilesStore((s) => s.profiles)
  const extraFolders = useProfilesStore((s) => s.extraFolders)
  const loaded = useProfilesStore((s) => s.loaded)
  const load = useProfilesStore((s) => s.load)
  const updateProfile = useProfilesStore((s) => s.update)
  const deleteProfile = useProfilesStore((s) => s.delete)
  const createFolder = useProfilesStore((s) => s.createFolder)
  const deleteFolderStore = useProfilesStore((s) => s.deleteFolder)
  const loadAll = useProfilesStore((s) => s.load)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [renaming, setRenaming] = useState<RenameTarget | null>(null)
  const [menu, setMenu] = useState<MenuState>(null)
  // Modal for "New folder" — window.prompt() is silently disabled by
  // Electron, so we render our own input prompt.
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  // Folder currently under a drag (for the highlight ring). null when not
  // dragging or hovering open whitespace.
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null)

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  const toggleGroup = (group: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }

  const handleDelete = async (profile: SessionProfile) => {
    if (!confirm(`Delete profile "${profile.name}"? This cannot be undone.`)) return
    await deleteProfile(profile.id)
  }

  // Bulk delete every profile in a group, then drop the folder from
  // extraFolders if it lived there too.
  const handleDeleteGroup = async (group: string) => {
    const inGroup = profiles.filter((p) => (p.group ?? '') === group)
    const isExtra = extraFolders.includes(group)
    if (inGroup.length === 0 && !isExtra) return
    const label = group || 'Ungrouped'
    const msg = inGroup.length > 0
      ? `Delete folder "${label}" and all ${inGroup.length} session(s) inside? This cannot be undone.`
      : `Delete empty folder "${label}"?`
    if (!confirm(msg)) return
    for (const p of inGroup) await deleteProfile(p.id)
    if (isExtra) await deleteFolderStore(group)
  }

  // Build the right-click menu's items based on what was clicked.
  const menuItems = (state: NonNullable<MenuState>): ContextMenuItem[] => {
    if (state.kind === 'profile') {
      return [
        {
          label: 'Connect',
          onClick: () => onConnect(state.profile),
        },
        {
          label: 'Rename (F2)',
          onClick: () => setRenaming({ kind: 'profile', key: state.profile.id }),
        },
        {
          label: 'Edit…',
          onClick: () => onEdit(state.profile),
        },
        {
          label: 'Delete session',
          onClick: () => void handleDelete(state.profile),
          danger: true,
        },
      ]
    }
    if (state.kind === 'group') {
      return [
        {
          label: 'New session in this folder',
          onClick: () => onNewProfile(),
        },
        {
          label: 'Rename folder (F2)',
          onClick: () => setRenaming({ kind: 'group', key: state.group }),
        },
        {
          label: 'Delete folder',
          onClick: () => void handleDeleteGroup(state.group),
          danger: true,
        },
      ]
    }
    return [
      { label: 'New session', onClick: () => onNewProfile() },
      { label: 'New folder', onClick: () => void handleNewFolder() },
      { label: 'Import sessions…', onClick: () => void handleImport() },
      { label: 'Export sessions…', onClick: () => void handleExport() },
    ]
  }

  // Commit a rename and exit edit mode. The new value is taken from the input
  // ref by the caller; we just persist it.
  const commitProfileRename = async (profile: SessionProfile, newName: string) => {
    const trimmed = newName.trim()
    if (trimmed.length === 0 || trimmed === profile.name) {
      setRenaming(null)
      return
    }
    await updateProfile({ ...profile, name: trimmed })
    setRenaming(null)
  }

  const commitGroupRename = async (oldGroup: string, newGroup: string) => {
    const trimmed = newGroup.trim()
    setRenaming(null)
    if (trimmed === oldGroup) return
    // Apply the new group name to every profile currently in oldGroup.
    // Empty trimmed means "move into Ungrouped" (undefined on profile).
    const targets = profiles.filter((p) => (p.group ?? '') === oldGroup)
    for (const p of targets) {
      await updateProfile({
        ...p,
        group: trimmed === '' ? undefined : trimmed,
      })
    }
  }

  const grouped = groupProfiles(profiles, extraFolders)

  // Drag-and-drop: move a profile into another folder. We use a custom MIME
  // so we never accept drags from outside the app (file drops, text, etc.).
  // dataTransfer payload is the profile id; resolved via the live `profiles`
  // array at drop time so we don't carry stale snapshots through the drag.
  const DRAG_MIME = 'application/x-cosmicssh-profile'
  const isProfileDrag = (e: React.DragEvent): boolean =>
    Array.from(e.dataTransfer.types).includes(DRAG_MIME)

  const handleProfileDrop = async (targetGroup: string, draggedId: string) => {
    const target = profiles.find((p) => p.id === draggedId)
    if (!target) return
    const currentGroup = target.group ?? ''
    if (currentGroup === targetGroup) return // dropped on its own folder — no-op
    await updateProfile({
      ...target,
      group: targetGroup === '' ? undefined : targetGroup,
    })
  }

  const handleNewFolder = () => {
    setNewFolderOpen(true)
  }

  const submitNewFolder = async (name: string) => {
    setNewFolderOpen(false)
    const trimmed = name.trim()
    if (!trimmed) return
    await createFolder(trimmed)
  }

  const handleExport = async () => {
    try {
      const result = await window.api.profiles.exportToFile()
      if (result) {
        alert(`Exported ${result.count} session(s) to:\n${result.path}`)
      }
    } catch (err) {
      alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const handleImport = async () => {
    try {
      const result = await window.api.profiles.importFromFile()
      if (result) {
        await loadAll() // refresh the sidebar with the newly added profiles
        alert(
          `Imported ${result.count} session(s)` +
            (result.folders > 0 ? ` and ${result.folders} folder(s).` : '.'),
        )
      }
    } catch (err) {
      alert(`Import failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return (
    <aside
      className="sidebar"
      onContextMenu={(e) => {
        // Right-click on empty whitespace in the sidebar opens the "empty"
        // menu. Rows/headers have their own onContextMenu handlers — we
        // bail out here if the click landed inside one of those (or inside
        // an open context menu) so we don't clobber their menu.
        const target = e.target as HTMLElement
        if (target.closest('.profile-row, .group-header, .context-menu')) return
        e.preventDefault()
        setMenu({ kind: 'empty', x: e.clientX, y: e.clientY })
      }}
    >
      <header className="sidebar-header">
        <span className="sidebar-title">Profiles</span>
        <div className="sidebar-actions">
          <button
            type="button"
            className="icon-btn"
            onClick={onNewProfile}
            title="New profile"
          >
            + New
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={onOpenSettings}
            title="Settings"
            aria-label="Settings"
          >
            ⚙
          </button>
        </div>
      </header>

      <div className="sidebar-list">
        {profiles.length === 0 && loaded && (
          <div className="empty-state">
            No profiles yet. Click <strong>+ New</strong> to add one.
          </div>
        )}

        {grouped.map(({ group, items }) => {
          const groupKey = group || '__ungrouped__'
          const isCollapsed = collapsed.has(groupKey)
          return (
            <div
              key={groupKey}
              className={`group${dragOverGroup === group ? ' drop-target' : ''}`}
              onDragOver={(e) => {
                if (!isProfileDrag(e)) return
                // Without preventDefault the browser refuses the drop.
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
              }}
              onDragEnter={(e) => {
                if (!isProfileDrag(e)) return
                setDragOverGroup(group)
              }}
              onDragLeave={(e) => {
                // Only clear when we've actually left the group container —
                // moving between the header and a child row fires dragleave
                // even though we're still over the same group.
                const next = e.relatedTarget as Node | null
                if (next && e.currentTarget.contains(next)) return
                setDragOverGroup((g) => (g === group ? null : g))
              }}
              onDrop={(e) => {
                if (!isProfileDrag(e)) return
                e.preventDefault()
                setDragOverGroup(null)
                const id = e.dataTransfer.getData(DRAG_MIME)
                if (id) void handleProfileDrop(group, id)
              }}
            >
              {renaming?.kind === 'group' && renaming.key === group ? (
                // Rename mode: plain div, no button. Nesting <input> inside
                // <button> is invalid HTML and Chromium steals focus back to
                // the button, blurring the input immediately.
                <div className="group-header rename-mode">
                  <span
                    className={`group-toggle ${isCollapsed ? 'collapsed' : 'expanded'}`}
                    aria-hidden="true"
                  >
                    {isCollapsed ? '+' : '−'}
                  </span>
                  <span className="group-icon">{isCollapsed ? '📁' : '📂'}</span>
                  <RenameInput
                    initial={group}
                    placeholder="Ungrouped"
                    onCommit={(v) => commitGroupRename(group, v)}
                    onCancel={() => setRenaming(null)}
                  />
                  <span className="count">{items.length}</span>
                </div>
              ) : (
                <button
                  type="button"
                  className="group-header"
                  onClick={() => toggleGroup(groupKey)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setMenu({ kind: 'group', group, x: e.clientX, y: e.clientY })
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'F2') {
                      e.preventDefault()
                      setRenaming({ kind: 'group', key: group })
                    }
                  }}
                  aria-expanded={!isCollapsed}
                >
                  <span
                    className={`group-toggle ${isCollapsed ? 'collapsed' : 'expanded'}`}
                    aria-hidden="true"
                  >
                    {isCollapsed ? '+' : '−'}
                  </span>
                  <span className="group-icon">{isCollapsed ? '📁' : '📂'}</span>
                  <span className="group-name">{group || 'Ungrouped'}</span>
                  <span className="count">{items.length}</span>
                </button>
              )}
              {!isCollapsed && (
                <ul className="profile-list">
                  {items.map((profile) => {
                    const jumpName = profile.jumpHost
                      ? profiles.find((p) => p.id === profile.jumpHost)?.name
                      : undefined
                    return (
                    <li key={profile.id} className="profile-item">
                      {renaming?.kind === 'profile' && renaming.key === profile.id ? (
                        <div className="profile-row rename-mode">
                          <span className="profile-icon">
                            {profile.protocol === 'sftp-only'
                              ? <GlobeIcon size={18} />
                              : <ComputerIcon size={18} />}
                          </span>
                          <span className="profile-text">
                            <RenameInput
                              initial={profile.name}
                              onCommit={(v) => commitProfileRename(profile, v)}
                              onCancel={() => setRenaming(null)}
                            />
                            <span className="profile-meta">
                              {profile.username}@{profile.host}
                              {jumpName && <span className="profile-via"> via {jumpName}</span>}
                            </span>
                          </span>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="profile-row"
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData(DRAG_MIME, profile.id)
                            e.dataTransfer.effectAllowed = 'move'
                          }}
                          onClick={() => onConnect(profile)}
                          onContextMenu={(e) => {
                            e.preventDefault()
                            setMenu({ kind: 'profile', profile, x: e.clientX, y: e.clientY })
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'F2') {
                              e.preventDefault()
                              setRenaming({ kind: 'profile', key: profile.id })
                            }
                          }}
                          title={
                            jumpName
                              ? `${profile.username}@${profile.host}:${profile.port} via ${jumpName}`
                              : `${profile.username}@${profile.host}:${profile.port}`
                          }
                        >
                          <span className="profile-icon">
                            {profile.protocol === 'sftp-only'
                              ? <GlobeIcon size={18} />
                              : <ComputerIcon size={18} />}
                          </span>
                          <span className="profile-text">
                            <span className="profile-name">
                              {profile.name}
                              {jumpName && <span className="jump-badge" title={`via ${jumpName}`}>↳</span>}
                            </span>
                            <span className="profile-meta">
                              {profile.username}@{profile.host}
                              {jumpName && <span className="profile-via"> via {jumpName}</span>}
                            </span>
                          </span>
                        </button>
                      )}
                      <div className="profile-actions">
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => onEdit(profile)}
                          title="Edit"
                        >
                          ✎
                        </button>
                        <button
                          type="button"
                          className="icon-btn danger"
                          onClick={() => handleDelete(profile)}
                          title="Delete"
                        >
                          ✕
                        </button>
                      </div>
                    </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )
        })}
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(menu)}
          onClose={() => setMenu(null)}
        />
      )}
      {newFolderOpen && (
        <InputPrompt
          title="New folder"
          label="Folder name"
          placeholder="e.g. RunPod"
          submitLabel="Create"
          onSubmit={submitNewFolder}
          onCancel={() => setNewFolderOpen(false)}
        />
      )}
    </aside>
  )
}

// Small inline rename input. Auto-focuses + selects, commits on Enter or
// blur, cancels on Escape. e.stopPropagation everywhere prevents the parent
// button's click handlers from firing (they would otherwise connect / toggle).
function RenameInput({
  initial,
  placeholder,
  onCommit,
  onCancel,
}: {
  initial: string
  placeholder?: string
  onCommit: (value: string) => void
  onCancel: () => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [value, setValue] = useState(initial)

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.focus()
    el.select()
  }, [])

  return (
    <input
      ref={inputRef}
      className="rename-input"
      type="text"
      value={value}
      placeholder={placeholder}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') {
          e.preventDefault()
          onCommit(value)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          onCancel()
        }
      }}
      onBlur={() => onCommit(value)}
    />
  )
}

// Memoized export. Callbacks must be stable (useCallback) on the caller side
// or this won't help — App.tsx already does that. With a couple dozen
// profile rows in the sidebar, every App-level state change (opening the
// password modal, switching tabs, etc.) was forcing the entire sidebar tree
// to reconcile; that was making the password input feel laggy right after
// import. Memo + stable callbacks fixes it.
export const Sidebar = memo(SidebarImpl)
