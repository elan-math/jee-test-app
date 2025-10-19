// src/app/report/[attemptId]/page.tsx
'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '../../../lib/supabaseClient'
import Spinner from '../../../components/Spinner'

// --- Types for Report Data ---
type QuestionAnalysis = {
  question_id: string;
  question_number: number;
  question_text: string | null;
  subject: string;
  correct_answer: any;
  solution_text: string | null;
  selected_answer: any | null;
  status: 'CORRECT' | 'INCORRECT' | 'UNATTEMPTED';
}

type SubjectStats = {
  correct: number;
  incorrect: number;
  unattempted: number;
  score: number;
}

type ReportData = {
  testName: string;
  totalScore: number;
  totalCorrect: number;
  totalIncorrect: number;
  totalUnattempted: number;
  subjectStats: {
    [key: string]: SubjectStats; // Use a dynamic key for subjects
  };
  questions: QuestionAnalysis[];
}

type ReportTab = 'ALL' | 'CORRECT' | 'INCORRECT' | 'UNATTEMPTED'

// --- Helper Function for Answer Comparison (ROBUST) ---
function isAnswerCorrect(qType: string, selected: any, correct: any): boolean {
  // 1. If no answer was selected, it's incorrect.
  if (selected === null || selected === undefined || selected === "") {
    return false;
  }
  
  // 2. If no correct answer is defined, it's incorrect.
  if (!Array.isArray(correct) || correct.length === 0) {
    return false;
  }

  try {
    const correctAnswer = correct[0]; // Get the "A" from ["A"] or 10 from [10]

    // 3. For SINGLE_CHOICE:
    if (qType === 'SINGLE_CHOICE') {
      return String(selected) === String(correctAnswer);
    }
    
    // 4. For NUMERICAL:
    if (qType === 'NUMERICAL') {
      const selectedNum = parseFloat(selected);
      const correctNum = parseFloat(correctAnswer);
      
      if (Number.isNaN(selectedNum) || Number.isNaN(correctNum)) {
        return false;
      }
      
      return Math.abs(correctNum - selectedNum) < 0.01;
    }

  } catch (e) {
    console.error("Error comparing answers:", e, { selected, correct });
    return false;
  }
  return false;
}


// --- The Main Report Page Component ---
export default function ReportPage() {
  const supabase = createClient()
  const router = useRouter()
  const params = useParams()
  const attemptId = params.attemptId as string

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reportData, setReportData] = useState<ReportData | null>(null)
  const [activeTab, setActiveTab] = useState<ReportTab>('ALL')

  // --- Data Fetching and Calculation Effect ---
  useEffect(() => {
    if (!attemptId) return

    const generateReport = async () => {
      try {
        // 1. Get the user (for security)
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          router.push('/login')
          return
        }

        // 2. Fetch the Attempt + Test Name
        const { data: attemptData, error: attemptError } = await supabase
          .from('User_Test_Attempts')
          .select('test_id, user_id, Tests(name)')
          .eq('attempt_id', attemptId)
          .single()

        if (attemptError) throw new Error(`Attempt not found. ${attemptError.message}`)
        if (attemptData.user_id !== user.id) throw new Error('You do not have permission to view this report.')

        const testId = attemptData.test_id
        
        // Fix for Supabase array join
        const testName = (attemptData.Tests && Array.isArray(attemptData.Tests) && attemptData.Tests.length > 0)
          ? attemptData.Tests[0].name
          : 'Test Report'

        // 3. Fetch all User's Answers
        const { data: userAnswers, error: answersError } = await supabase
          .from('User_Answer_Responses')
          .select('question_id, selected_answer')
          .eq('attempt_id', attemptId)
        
        if (answersError) throw new Error(`Could not fetch answers. ${answersError.message}`)
        
        const answerMap = new Map<string, any>()
        userAnswers.forEach(ans => {
          answerMap.set(ans.question_id, ans.selected_answer)
        })

        // 4. Fetch all Questions + Solutions
        const { data: questionLinks, error: questionsError } = await supabase
          .from('Test_Questions_Link')
          .select('question_number, Questions(*)')
          .eq('test_id', testId)
          .order('question_number', { ascending: true })
        
        if (questionsError) throw new Error(`Could not fetch questions. ${questionsError.message}`)

        // 5. --- Calculate Score ---
        const newReportData: ReportData = {
          testName,
          totalScore: 0,
          totalCorrect: 0,
          totalIncorrect: 0,
          totalUnattempted: 0,
          subjectStats: {}, // Initialize as empty object
          questions: [],
        }

        for (const link of questionLinks) {
          // Fix for Supabase array join
          if (!link.Questions || !Array.isArray(link.Questions) || link.Questions.length === 0) {
            continue 
          }
          const q = link.Questions[0] 
          
          if (!q) continue

          const question_id = q.question_id
          const selected_answer = answerMap.get(question_id) || null
          const subject = (q.subject || 'UNCATEGORIZED').toUpperCase()
          
          // Dynamically create subject stats if they don't exist
          if (!newReportData.subjectStats[subject]) {
             newReportData.subjectStats[subject] = { correct: 0, incorrect: 0, unattempted: 0, score: 0 }
          }
          
          let status: 'CORRECT' | 'INCORRECT' | 'UNATTEMPTED'
          
          if (selected_answer === null || selected_answer === "") {
            status = 'UNATTEMPTED'
            newReportData.totalUnattempted++
            newReportData.subjectStats[subject].unattempted++
          } else if (isAnswerCorrect(q.question_type, selected_answer, q.correct_answer)) {
            status = 'CORRECT'
            newReportData.totalCorrect++
            newReportData.subjectStats[subject].correct++
          } else {
            status = 'INCORRECT'
            newReportData.totalIncorrect++
            newReportData.subjectStats[subject].incorrect++
          }

          newReportData.questions.push({
            question_id,
            question_number: link.question_number,
            question_text: q.question_text,
            subject: q.subject,
            correct_answer: q.correct_answer,
            solution_text: q.solution_text,
            selected_answer: selected_answer,
            status: status,
          })
        }
        
        // Calculate scores
        newReportData.totalScore = (newReportData.totalCorrect * 4) - (newReportData.totalIncorrect * 1)
        for (const sub of Object.keys(newReportData.subjectStats)) {
          const stats = newReportData.subjectStats[sub]
          stats.score = (stats.correct * 4) - (stats.incorrect * 1)
        }

        setReportData(newReportData)

      } catch (err: any) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    generateReport()
  }, [attemptId, supabase, router])

  // --- Render Logic ---
  if (loading) {
    return (
      <div className="flex flex-col justify-center items-center min-h-screen">
        <Spinner />
        <p className="ml-4 text-lg mt-4">Generating your report...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded" role="alert">
          <strong className="font-bold">Error: </strong>
          <span className="block sm:inline">{error}</span>
        </div>
      </div>
    )
  }

  if (!reportData) {
    return <div>No report data found.</div>
  }

  const filteredQuestions = reportData.questions.filter(q => {
    if (activeTab === 'ALL') return true
    return q.status === activeTab
  })

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <header className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">{reportData.testName} - Report</h1>
        <button
          onClick={() => router.push('/dashboard')}
          className="bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600"
        >
          Back to Dashboard
        </button>
      </header>

      {/* --- Section 1: Overall Performance --- */}
      <div className="mb-8 p-6 bg-white rounded-lg shadow-md">
        <h2 className="text-2xl font-semibold mb-4">Overall Performance</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
          <div className="p-4 bg-blue-100 rounded-lg">
            <div className="text-3xl font-bold text-blue-800">{reportData.totalScore}</div>
            <div className="text-sm text-gray-600">Total Score</div>
          </div>
          <div className="p-4 bg-green-100 rounded-lg">
            <div className="text-3xl font-bold text-green-800">{reportData.totalCorrect}</div>
            <div className="text-sm text-gray-600">Correct</div>
          </div>
          <div className="p-4 bg-red-100 rounded-lg">
            <div className="text-3xl font-bold text-red-800">{reportData.totalIncorrect}</div>
            <div className="text-sm text-gray-600">Incorrect</div>
          </div>
          <div className="p-4 bg-gray-100 rounded-lg">
            <div className="text-3xl font-bold text-gray-800">{reportData.totalUnattempted}</div>
            <div className="text-sm text-gray-600">Unattempted</div>
          </div>
        </div>
      </div>

      {/* --- Section 2: Subject-wise Breakdown --- */}
      <div className="mb-8 p-6 bg-white rounded-lg shadow-md">
        <h2 className="text-2xl font-semibold mb-4">Subject-wise Breakdown</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left min-w-max">
            <thead className="bg-gray-100">
              <tr>
                <th className="p-4">Subject</th>
                <th className="p-4">Score</th>
                <th className="p-4">Correct</th>
                <th className="p-4">Incorrect</th>
                <th className="p-4">Unattempted</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(reportData.subjectStats).map(([subject, stats]) => (
                <tr key={subject} className="border-b">
                  <td className="p-4 font-medium">{subject}</td>
                  <td className="p-4 font-bold">{stats.score}</td>
                  <td className="p-4 text-green-600">{stats.correct}</td>
                  <td className="p-4 text-red-600">{stats.incorrect}</td>
                  <td className="p-4 text-gray-600">{stats.unattempted}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* --- Section 3: Solution Review --- */}
      <div className="p-6 bg-white rounded-lg shadow-md">
        <h2 className="text-2xl font-semibold mb-4">Solution Review</h2>
        <div className="border-b border-gray-200 mb-4">
          <nav className="flex space-x-4 overflow-x-auto">
            {(['ALL', 'CORRECT', 'INCORRECT', 'UNATTEMPTED'] as ReportTab[]).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`py-2 px-4 font-medium whitespace-nowrap ${
                  activeTab === tab 
                  ? 'border-b-2 border-blue-500 text-blue-600' 
                  : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab}
              </button>
            ))}
          </nav>
        </div>
        
        {/* Question List */}
        <div className="space-y-6">
          {filteredQuestions.length > 0 ? (
            filteredQuestions.map(q => (
              <QuestionReviewCard key={q.question_id} question={q} />
            ))
          ) : (
            <p className="text-gray-600">No questions in this category.</p>
          )}
        </div>
      </div>
    </div>
  )
}

// --- Internal Component for displaying a single question review ---
function QuestionReviewCard({ question }: { question: QuestionAnalysis }) {
  const [showSolution, setShowSolution] = useState(false)

  const getAnswerDisplay = (answer: any) => {
    if (answer === null || answer === undefined || answer === "") return 'Not Answered'
    if (typeof answer === 'number' || !isNaN(parseFloat(answer))) {
        return String(parseFloat(answer))
    }
    if (Array.isArray(answer)) return answer.join(', ')
    return String(answer)
  }
  
  const getCorrectAnswerDisplay = (answer: any) => {
    if (answer === null || answer === undefined) return 'N/A'
    if (Array.isArray(answer)) {
        return answer.map(a => getAnswerDisplay(a)).join(', ')
    }
    return getAnswerDisplay(answer)
  }

  const isCorrect = question.status === 'CORRECT'

  return (
    <div className="border border-gray-200 rounded-lg p-6">
      <h3 className="font-semibold text-lg mb-4">
        Question {question.question_number} ({question.subject})
      </h3>
      <div className="prose mb-4">{question.question_text}</div>

      <div className="space-y-2 mb-4">
        <div className={`p-3 rounded ${
          isCorrect ? 'bg-green-100' : 'bg-red-100'
        }`}>
          <span className="font-semibold">Your Answer: </span>
          <span className={isCorrect ? 'text-green-700' : 'text-red-700'}>
            {getAnswerDisplay(question.selected_answer)}
          </span>
        </div>
        {!isCorrect && (
          <div className="p-3 rounded bg-green-100">
            <span className="font-semibold">Correct Answer: </span>
            <span className="text-green-700">
              {getCorrectAnswerDisplay(question.correct_answer)}
            </span>
          </div>
        )}
      </div>

      <button
        onClick={() => setShowSolution(!showSolution)}
        className="text-blue-600 hover:underline"
      >
        {showSolution ? 'Hide Solution' : 'Show Solution'}
      </button>

      {showSolution && (
        <div className="mt-4 pt-4 border-t border-gray-200 prose">
          <h4 className="font-semibold">Solution:</h4>
          <p>{question.solution_text || 'No solution provided.'}</p>
        </div>
      )}
    </div>
  )
}