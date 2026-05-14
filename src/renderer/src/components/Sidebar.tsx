import { useEffect, useState } from 'react'
import { groupProfiles, useProfilesStore } from '../stores/profiles-store'
import type { SessionProfile } from '../../../shared/types'

type Props = {
  onConnect: (profile: SessionProfile) => void
  onEdit: (profile: SessionProfile) => void
  onNewProfile: () => void
  onOpenSettings: () => void
}

export function Sidebar({ onConnect, onEdit, onNewProfile, onOpenSettings }: Props) {
  const profiles = useProfilesStore((s) => s.profiles)
  const loaded = useProfilesStore((s) => s.loaded)
  const load = useProfilesStore((s) => s.load)
  const deleteProfile = useProfilesStore((s) => s.delete)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

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

  const grouped = groupProfiles(profiles)

  return (
    <aside className="sidebar">
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
            <div key={groupKey} className="group">
              <button
                type="button"
                className="group-header"
                onClick={() => toggleGroup(groupKey)}
              >
                <span className="caret">{isCollapsed ? '▸' : '▾'}</span>
                <span>{group || 'Ungrouped'}</span>
                <span className="count">{items.length}</span>
              </button>
              {!isCollapsed && (
                <ul className="profile-list">
                  {items.map((profile) => {
                    const jumpName = profile.jumpHost
                      ? profiles.find((p) => p.id === profile.jumpHost)?.name
                      : undefined
                    return (
                    <li key={profile.id} className="profile-item">
                      <button
                        type="button"
                        className="profile-row"
                        onClick={() => onConnect(profile)}
                        title={
                          jumpName
                            ? `${profile.username}@${profile.host}:${profile.port} via ${jumpName}`
                            : `${profile.username}@${profile.host}:${profile.port}`
                        }
                      >
                        <span className="profile-name">
                          {profile.name}
                          {jumpName && <span className="jump-badge" title={`via ${jumpName}`}>↳</span>}
                        </span>
                        <span className="profile-meta">
                          {profile.username}@{profile.host}
                          {jumpName && <span className="profile-via"> via {jumpName}</span>}
                        </span>
                      </button>
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
    </aside>
  )
}
