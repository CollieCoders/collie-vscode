<div className={rootClassName}>
  <header className="dashboard-header">
    <div className="header-left">
      <h1 className="dashboard-title">Collie Admin Dashboard</h1>
      <span className="dashboard-subtitle">A TSX feature showcase</span>
    </div>
    <div className="header-right">
      <button
        type="button"
        className="btn btn-ghost"
        onClick={toggleTheme}
      >
        Toggle theme ({theme})
      </button>
      <button
        type="button"
        className="btn btn-primary"
        onClick={onLogout}
      >
        Logout
      </button>
    </div>
  </header>

  <main className="dashboard-main">
    <section className="dashboard-metrics">
      {metrics.map((metric) => (
        <MetricCard key={metric.id} metric={metric} />
      ))}
    </section>

    <section className="dashboard-content">
      <div className="mt-4 p-4 bg-red-100 text-red-700 rounded-lg border border-red-300">
        <div className="users-header">
          <h2>Users</h2>
          <div className="users-filters">
            <SearchInput
              value={filter.search}
              onChange={handleSearchChange}
              placeholder="Search by name, email, or role…"
            />
            <select
              className="select"
              value={filter.role}
              onChange={handleRoleChange}
            >
              <option value="all">All roles</option>
              <option value="admin">Admins</option>
              <option value="editor">Editors</option>
              <option value="viewer">Viewers</option>
            </select>
            <Toggle
              label="Only active"
              checked={filter.onlyActive}
              onChange={handleOnlyActiveChange}
            />
          </div>
        </div>
      </div>

      <SuspenseLike
        status={status}
        fallback={<div>Loading users…</div>}
      >
        {() => (
          <DataTable<User>
            items={filteredUsers}
            getRowKey={(u) => u.id}
            emptyState={<div>No users match this filter.</div>}
            columns={[
              {
                key: "name",
                header: "User",
                render: (_value, user) => (
                  <button
                    type="button"
                    className={`user-button ${
                      user.id === selectedUserId ? "user-button-selected" : ""
                    }`}
                    onClick={() => handleSelectUser(user.id)}
                  >
                    <Avatar user={user} size={28} />
                    <span className="user-name-email">
                      <span className="user-name">{user.name}</span>
                      <span className="user-email">{user.email}</span>
                    </span>
                  </button>
                ),
              },
              {
                key: "role",
                header: "Role",
                render: (value) => (
                  <span className="user-role">{value}</span>
                ),
              },
              {
                key: "isActive",
                header: "Status",
                align: "center",
                render: (value) =>
                  value ? (
                    <Badge color="green">Active</Badge>
                  ) : (
                    <Badge color="gray">Inactive</Badge>
                  ),
              },
              {
                key: "createdAt",
                header: "Created",
                render: (value) => (
                  <span>
                    {new Date(value as string).toLocaleDateString(
                      undefined,
                      { dateStyle: "medium" }
                    )}
                  </span>
                ),
              },
            ]}
          />
        )}
      </SuspenseLike>

      <aside className="dashboard-sidebar">
        <section className="sidebar-panel">
          <h2>Selected User</h2>
          {selectedUser ? (
            <div className="selected-user-card">
              <div className="selected-user-header">
                <Avatar user={selectedUser} size={40} />
                <div>
                  <div className="selected-user-name">
                    {selectedUser.name}
                  </div>
                  <div className="selected-user-email">
                    {selectedUser.email}
                  </div>
                </div>
              </div>
              <div className="selected-user-meta">
                <div>
                  Role: <strong>{selectedUser.role}</strong>
                </div>
                <div>
                  Created:{" "}
                  {new Date(
                    selectedUser.createdAt
                  ).toLocaleDateString(undefined, {
                    dateStyle: "medium",
                  })}
                </div>
                <div>
                  Last login:{" "}
                  {selectedUser.lastLoginAt
                    ? new Date(
                        selectedUser.lastLoginAt
                      ).toLocaleString()
                    : "Never"}
                </div>
                <div>
                  Status:{" "}
                  {selectedUser.isActive ? (
                    <Badge color="green">Active</Badge>
                  ) : (
                    <Badge color="red">Disabled</Badge>
                  )}
                </div>
              </div>
              <button
                type="button"
                className="btn btn-secondary"
              >
                View full profile
              </button>
            </div>
          ) : (
            <div className="selected-user-empty">
              Select a user from the table to view details.
            </div>
          )}
        </section>

        <section className="sidebar-panel">
          <h2>Recent Activity</h2>
          <SuspenseLike status={status}>
            {() => <ActivityList items={activity} />}
          </SuspenseLike>
        </section>
      </aside>
    </section>
  </main>
</div>