import { useEffect, useState } from 'react'
import { Button } from '../../components/ui'

export default function AdminDashboard() {
  const [stats, setStats] = useState<any>(null)
  const [health, setHealth] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)

  useEffect(() => {
    const headers = { 'x-admin-token': localStorage.getItem('admin_token') || '' }
    
    Promise.all([
      fetch('/api/admin/health', { headers }).then(res => res.json()),
      fetch('/api/admin/stats', { headers }).then(res => res.json())
    ]).then(([healthData, statsData]) => {
      setHealth(healthData)
      setStats(statsData)
      setLoading(false)
    }).catch(err => {
      console.error(err)
      setLoading(false)
    })
  }, [])

  if (loading) return <div>Loading dashboard...</div>

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Dashboard</h1>
      <div className="flex gap-3">
        <Button
          onClick={async () => {
            try {
              setSyncing(true)
              setSyncResult(null)
              const res = await fetch('/api/admin/shopify/sync', {
                method: 'POST',
                headers: { 'x-admin-token': localStorage.getItem('admin_token') || '' }
              })
              const data = await res.json()
              setSyncing(false)
              setSyncResult(res.ok ? `Synced ${data.count || 0} products from Shopify` : (data.error || 'Sync failed'))
              const statsRes = await fetch('/api/admin/stats', { headers: { 'x-admin-token': localStorage.getItem('admin_token') || '' } })
              const statsData = await statsRes.json()
              setStats(statsData)
            } catch {
              setSyncing(false)
              setSyncResult('Sync failed')
            }
          }}
          disabled={syncing}
        >
          {syncing ? 'Syncing…' : 'Pull Shopify Data'}
        </Button>
        {syncResult && <span className="text-sm text-gray-600 dark:text-gray-400">{syncResult}</span>}
      </div>
      
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {/* System Health */}
        <div className="bg-white dark:bg-neutral-800 overflow-hidden shadow rounded-lg border border-gray-200 dark:border-neutral-700">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className={`h-3 w-3 rounded-full ${health?.status === 'ok' ? 'bg-green-500' : 'bg-red-500'}`} />
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate">System Status</dt>
                  <dd className="text-lg font-medium text-gray-900 dark:text-white">{health?.status === 'ok' ? 'Operational' : 'Issues Detected'}</dd>
                </dl>
              </div>
            </div>
          </div>
          <div className="bg-gray-50 dark:bg-neutral-900 px-5 py-3">
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Storage: {health?.storage ? 'Connected' : 'Disconnected'}
            </div>
          </div>
        </div>

        {/* Product Count */}
        <div className="bg-white dark:bg-neutral-800 overflow-hidden shadow rounded-lg border border-gray-200 dark:border-neutral-700">
          <div className="p-5">
            <div className="flex items-center">
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate">Total Products</dt>
                  <dd className="text-lg font-medium text-gray-900 dark:text-white">{stats?.products || 0}</dd>
                </dl>
              </div>
            </div>
          </div>
          <div className="bg-gray-50 dark:bg-neutral-900 px-5 py-3">
            <a href="/admin/products" className="text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-300">
              View all
            </a>
          </div>
        </div>

        {/* Order Count */}
        <div className="bg-white dark:bg-neutral-800 overflow-hidden shadow rounded-lg border border-gray-200 dark:border-neutral-700">
          <div className="p-5">
            <div className="flex items-center">
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate">Total Orders</dt>
                  <dd className="text-lg font-medium text-gray-900 dark:text-white">{stats?.orders || 0}</dd>
                </dl>
              </div>
            </div>
          </div>
          <div className="bg-gray-50 dark:bg-neutral-900 px-5 py-3">
            <a href="/admin/orders" className="text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-300">
              View all
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
