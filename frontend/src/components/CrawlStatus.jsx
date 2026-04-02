import { useState, useEffect, useRef } from 'react'
import { api } from '../api'

export default function CrawlStatus({ projectId, onDone, onBack }) {
  const [status, setStatus] = useState(null)
  const [project, setProject] = useState(null)
  const [analyzing, setAnalyzing] = useState(false)
  const intervalRef = useRef(null)

  const fetchStatus = async () => {
    try {
      const [s, p] = await Promise.all([
        api.crawlStatus(projectId),
        api.getProject(projectId),
      ])
      setStatus(s)
      setProject(p)

      if (p.status === 'done') {
        clearInterval(intervalRef.current)
        onDone()
      }
      if (p.status === 'analyzing') {
        setAnalyzing(true)
      }
    } catch (e) {
      console.error(e)
    }
  }

  useEffect(() => {
    fetchStatus()
    intervalRef.current = setInterval(fetchStatus, 2000)
    return () => clearInterval(intervalRef.current)
  }, [projectId])

  const handleAnalyze = async () => {
    setAnalyzing(true)
    try {
      await api.startAnalysis(projectId)
    } catch (e) {
      setAnalyzing(false)
      console.error(e)
    }
  }

  const progress = status?.pages_found > 0
    ? Math.round((status.pages_crawled / status.pages_found) * 100)
    : 0

  const isCrawling = project?.status === 'crawling'
  const isCrawled = project?.status === 'crawled'
  const isAnalyzing = project?.status === 'analyzing'

  return (
    <div className="max-w-xl mx-auto">
      <button onClick={onBack} className="text-slate-400 hover:text-slate-200 mb-6 flex items-center gap-1 transition">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back
      </button>

      <div className="bg-slate-800 rounded-xl p-8">
        <h2 className="text-xl font-bold mb-1">{project?.name || 'Loading...'}</h2>
        <p className="text-slate-400 text-sm mb-8">{project?.domain}</p>

        {/* Crawl section */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-medium flex items-center gap-2">
              {isCrawling && <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />}
              {isCrawled && <span className="w-2 h-2 rounded-full bg-green-400" />}
              {isAnalyzing && <span className="w-2 h-2 rounded-full bg-green-400" />}
              Crawl
            </h3>
            <span className="text-sm text-slate-400">
              {status?.pages_crawled || 0} / {status?.pages_found || 0} pages
            </span>
          </div>

          <div className="w-full bg-slate-700 rounded-full h-3 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500 ease-out"
              style={{
                width: `${isCrawling ? Math.max(progress, 2) : (isCrawled || isAnalyzing) ? 100 : 0}%`,
                background: isCrawling ? '#eab308' : '#22c55e',
              }}
            />
          </div>

          {status?.error && (
            <p className="text-red-400 text-sm mt-2">{status.error}</p>
          )}

          {status?.status === 'done' && (
            <p className="text-green-400 text-sm mt-2">
              Crawl complete - {status.pages_crawled} pages collected
            </p>
          )}
        </div>

        {/* Analysis section */}
        {(isCrawled || isAnalyzing) && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium flex items-center gap-2">
                {isAnalyzing && <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />}
                Semantic Analysis
              </h3>
            </div>

            {isAnalyzing ? (
              <div>
                <div className="w-full bg-slate-700 rounded-full h-3 overflow-hidden">
                  <div className="h-full rounded-full bg-purple-500 animate-pulse" style={{ width: '60%' }} />
                </div>
                <p className="text-purple-400 text-sm mt-2">
                  Computing embeddings and similarity scores...
                </p>
              </div>
            ) : isCrawled && !analyzing ? (
              <button
                onClick={handleAnalyze}
                className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-500 rounded-lg font-medium transition"
              >
                Start Analysis
              </button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
