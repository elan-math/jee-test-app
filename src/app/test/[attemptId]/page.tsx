// src/app/test/[attemptId]/page.tsx
'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { createClient } from '../../../lib/supabaseClient'
import Spinner from '../../../components/Spinner'

// --- Types ---
type Question = {
  question_id: string;
  question_text: string | null;
  question_image_url: string | null;
  question_type: string;
  options: { id: string; text: string }[] | null;
  question_number: number;
}

type AnswerStatus = 'not_visited' | 'unanswered' | 'answered' | 'marked_for_review'

type QuestionState = {
  status: AnswerStatus;
  selected_answer: any | null;
  time_taken_sec: number;
}

type TestState = {
  [question_id: string]: QuestionState;
}

// --- The Main Test Page Component ---
export default function TestPage() {
  // --- FIX: All declarations must be at the top ---
  const supabase = createClient()
  const router = useRouter()
  const params = useParams()
  const attemptId = params.attemptId as string // <-- This was at line 141, now it's here

  // --- State Variables ---
  const [questions, setQuestions] = useState<Question[]>([])
  const [testDuration, setTestDuration] = useState(180) 
  const [timeLeft, setTimeLeft] = useState(180 * 60) 
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
  const [testState, setTestState] = useState<TestState>({})
  const [loading, setLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Use a Ref to track state for background saves
  const testStateRef = useRef(testState)
  useEffect(() => {
    testStateRef.current = testState
  }, [testState])


  // --- Helper Function ---
  const getQuestionState = (qId: string): QuestionState => {
    return testState[qId] || {
      status: 'not_visited',
      selected_answer: null,
      time_taken_sec: 0,
    }
  }

  // --- 1. Data Fetching Effect (Runs once) ---
  useEffect(() => {
    if (!attemptId) return // <-- This is line 64, which now works

    const fetchTestData = async () => {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession()
      if (sessionError || !session) {
        router.push('/login')
        return
      }

      // Fetch attempt and joined Test data
      const { data: attemptData, error: attemptError } = await supabase
        .from('User_Test_Attempts')
        .select('test_id, user_id, Tests(duration_minutes)') // Select joined data
        .eq('attempt_id', attemptId)
        .eq('user_id', session.user.id) 
        .single()

      if (attemptError || !attemptData) {
        alert('Could not load test. Invalid attempt ID.')
        router.push('/dashboard')
        return
      }
      
      // FIX: Handle Tests(duration_minutes) returning an array
      const testDetails = attemptData.Tests;
      const duration = (testDetails && Array.isArray(testDetails) && testDetails.length > 0)
        ? testDetails[0].duration_minutes
        : 180;
      
      setTestDuration(duration)
      setTimeLeft(duration * 60) 

      // Fetch questions and joined Question data
      const { data: questionLinks, error: questionsError } = await supabase
        .from('Test_Questions_Link')
        .select('question_number, Questions(*)') // Select all from joined Questions
        .eq('test_id', attemptData.test_id)
        .order('question_number', { ascending: true })

      if (questionsError || !questionLinks) {
        alert('Could not load test questions.')
        return
      }
      
      // FIX: Handle Questions(*) returning an object
      const fetchedQuestions: Question[] = questionLinks.map(link => {
         const qData = (link.Questions && !Array.isArray(link.Questions)) ? link.Questions : null;
         return {
            ...qData,
            question_id: qData?.question_id || '',
            question_number: link.question_number,
         } as Question
      }).filter(q => q.question_id); // Filter out any nulls
      
      setQuestions(fetchedQuestions)

      const initialState: TestState = {}
      fetchedQuestions.forEach(q => {
        initialState[q.question_id] = {
          status: 'not_visited',
          selected_answer: null,
          time_taken_sec: 0,
        }
      })
      
      if (fetchedQuestions.length > 0) {
        initialState[fetchedQuestions[0].question_id].status = 'unanswered'
      }

      setTestState(initialState)
      testStateRef.current = initialState
      setLoading(false)
    }

    fetchTestData()
  }, [attemptId, supabase, router]) // attemptId is now correctly in scope

  // --- 2. Timer Effect ---
  useEffect(() => {
    if (loading || isSubmitting) return 
    if (timeLeft <= 0) {
      handleSubmitTest()
      return
    }
    const timerInterval = setInterval(() => {
      setTimeLeft((prevTime) => prevTime - 1)
    }, 1000)
    return () => clearInterval(timerInterval)
  }, [timeLeft, loading, isSubmitting])
  
  // --- 3. Save Answer Function (CORRECTED) ---
  const saveAnswerToDB = async (qId: string) => {
    const stateToSave = testStateRef.current[qId]
    if (!stateToSave) return 

    let dbAction = stateToSave.status;
    if (dbAction === 'not_visited') {
      dbAction = 'unanswered';
    }

    const { error } = await supabase
      .from('User_Answer_Responses')
      .upsert({
        attempt_id: attemptId,
        question_id: qId,
        selected_answer: stateToSave.selected_answer,
        action: dbAction // <-- Saves the correct action
      }, {
        onConflict: 'attempt_id, question_id' 
      })

    if (error) {
      console.error('Failed to save answer:', error)
    }
  }

  // --- 4. Navigation Function ---
  const navigateToQuestion = (newIndex: number) => {
    if (newIndex < 0 || newIndex >= questions.length || newIndex === currentQuestionIndex) {
      return
    }

    const oldQId = questions[currentQuestionIndex].question_id
    saveAnswerToDB(oldQId) 
    
    const newQId = questions[newIndex].question_id
    const newState = getQuestionState(newQId) 
    
    if (newState.status === 'not_visited') {
      setTestState(prevState => ({
        ...prevState,
        [newQId]: {
          ...newState,
          status: 'unanswered',
        }
      }))
    }
    
    setCurrentQuestionIndex(newIndex)
  }

  // --- Event Handlers (CORRECTED with prevState) ---

  const handleSaveAndNext = () => {
    navigateToQuestion(currentQuestionIndex + 1)
  }

  const handleMarkForReview = () => {
    const qId = questions[currentQuestionIndex].question_id
    setTestState(prevState => {
      const oldQState = prevState[qId] || getQuestionState(qId);
      return {
        ...prevState,
        [qId]: {
          ...oldQState,
          status: 'marked_for_review',
        }
      }
    })
    navigateToQuestion(currentQuestionIndex + 1)
  }

  const handleClearResponse = () => {
    const qId = questions[currentQuestionIndex].question_id
    setTestState(prevState => {
      const oldQState = prevState[qId] || getQuestionState(qId);
      return {
        ...prevState,
        [qId]: {
          ...oldQState,
          status: 'unanswered',
          selected_answer: null,
        }
      }
    })
  }

  const handleAnswerChange = (selectedOption: any) => {
    const qId = questions[currentQuestionIndex].question_id
    const newStatus: AnswerStatus = (selectedOption !== null && selectedOption !== '') ? 'answered' : 'unanswered' 
    setTestState(prevState => {
      const oldQState = prevState[qId] || getQuestionState(qId);
      return {
        ...prevState,
        [qId]: {
          ...oldQState,
          selected_answer: selectedOption, 
          status: newStatus, 
        }
      }
    })
  }

  const jumpToQuestion = (index: number) => {
    navigateToQuestion(index)
  }

  // --- SUBMIT FUNCTION (Redirects to Report) ---
  const handleSubmitTest = async () => {
    if (isSubmitting) return
    
    const confirmSubmit = window.confirm('Are you sure you want to submit the test?')
    if (!confirmSubmit) {
      return
    }

    setIsSubmitting(true)
    
    // 1. Final save of the current question
    const currentQId = questions[currentQuestionIndex].question_id
    await saveAnswerToDB(currentQId) 

    // 2. Update the User_Test_Attempts table
    const { error } = await supabase
      .from('User_Test_Attempts')
      .update({
        status: 'COMPLETED',
        end_time: new Date().toISOString(),
      })
      .eq('attempt_id', attemptId)

    if (error) {
      console.error('Error submitting test:', error)
      alert('There was an error submitting your test. Please try again.')
      setIsSubmitting(false)
      return
    }
    
    // 3. Redirect to the report page
    router.push(`/report/${attemptId}`)
  }

  // --- Helper to format timer ---
  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600).toString().padStart(2, '0')
    const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0')
    const s = (seconds % 60).toString().padStart(2, '0')
    return `${h}:${m}:${s}`
  }
  
  // --- Render Logic ---
  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <Spinner />
        <p className="ml-4 text-lg">Loading your test...</p>
      </div>
    )
  }

  if (questions.length === 0) {
    return <div>Error: No questions found for this test.</div>
  }

  const currentQuestion = questions[currentQuestionIndex]
  const currentQState = getQuestionState(currentQuestion.question_id)

  return (
    <div className="flex flex-col h-screen">
      {/* --- 1. Header --- */}
      <header className="flex justify-between items-center p-4 bg-gray-800 text-white shadow-md">
        <h1 className="text-xl font-bold">MVP Sample Test</h1>
        <div className="text-lg font-mono bg-white text-gray-800 px-4 py-2 rounded">
          Time Left: {formatTime(timeLeft)}
        </div>
        <button
          onClick={handleSubmitTest}
          disabled={isSubmitting}
          className="bg-green-500 hover:bg-green-600 text-white px-6 py-2 rounded-lg disabled:bg-gray-400"
        >
          {isSubmitting ? 'Submitting...' : 'Submit Test'}
        </button>
      </header>

      {/* --- 2. Main Content (Test UI) --- */}
      <div className="flex flex-1 overflow-hidden">
        
        {/* --- 2A. Left/Main Question Area --- */}
        <div className="flex-1 flex flex-col p-6 overflow-y-auto">
          <div className="bg-white p-6 rounded-lg shadow-lg flex-1">
            <h2 className="text-xl font-semibold mb-4">
              Question {currentQuestion.question_number}
            </h2>
            
            <div className="text-lg mb-6 prose">
              {currentQuestion.question_text}
            </div>

            {currentQuestion.question_image_url && (
              <img src={currentQuestion.question_image_url} alt="Question" className="mb-6" />
            )}

            {/* --- Options --- */}
            <div className="space-y-4">
              {currentQuestion.question_type === 'SINGLE_CHOICE' && currentQuestion.options && (
                currentQuestion.options.map(option => (
                  <label key={option.id} className="flex items-center p-4 border rounded-lg cursor-pointer hover:bg-gray-50">
                    <input
                      type="radio"
                      name={`question_${currentQuestion.question_id}`}
                      className="h-5 w-5 text-blue-600"
                      value={option.id}
                      checked={currentQState.selected_answer === option.id}
                      onChange={() => handleAnswerChange(option.id)}
                    />
                    <span className="ml-4 text-lg">{option.text}</span>
                  </label>
                ))
              )}

              {currentQuestion.question_type === 'NUMERICAL' && (
                <input
                  type="number"
                  step="any"
                  className="w-full p-4 border rounded-lg text-lg"
                  placeholder="Enter your numerical answer"
                  value={currentQState.selected_answer || ''}
                  onChange={(e) => handleAnswerChange(e.target.value)}
                />
              )}
            </div>
          </div>
          
          {/* --- Bottom Navigation Bar --- */}
          <div className="flex justify-between items-center pt-6">
            <button
              onClick={handleMarkForReview}
              className="bg-purple-500 hover:bg-purple-600 text-white px-6 py-3 rounded-lg"
            >
              Mark for Review & Next
            </button>
            <button
              onClick={handleClearResponse}
              className="bg-gray-500 hover:bg-gray-600 text-white px-6 py-3 rounded-lg"
            >
              Clear Response
            </button>
            <button
              onClick={handleSaveAndNext}
              className="bg-blue-500 hover:bg-blue-600 text-white px-6 py-3 rounded-lg"
            >
              Save & Next
            </button>
          </div>
        </div>

        {/* --- 2B. Right Question Palette --- */}
        <div className="w-1/4 bg-gray-100 p-6 overflow-y-auto border-l">
          <h3 className="text-lg font-semibold mb-4 text-center">Question Palette</h3>
          <div className="grid grid-cols-5 gap-2">
            {questions.map((q, index) => {
              const state = getQuestionState(q.question_id)
              
              let bgColor = 'bg-gray-300' // 'not_visited'
              if (state.status === 'answered') bgColor = 'bg-green-500'
              if (state.status === 'unanswered') bgColor = 'bg-red-500'
              if (state.status === 'marked_for_review') bgColor = 'bg-purple-500'
              
              const isCurrent = index === currentQuestionIndex
              const border = isCurrent ? 'border-4 border-blue-500' : 'border-2 border-transparent'

              return (
                <button
                  key={q.question_id}
                  onClick={() => jumpToQuestion(index)}
                  className={`flex items-center justify-center w-12 h-12 rounded-lg text-white font-bold ${bgColor} ${border}`}
                >
                  {q.question_number}
                </button>
              )
            })}
          </div>
          
          <div className="mt-8 space-y-2">
            <div className="flex items-center"><span className="w-5 h-5 bg-green-500 rounded-full mr-2"></span> Answered</div>
            <div className="flex items-center"><span className="w-5 h-5 bg-red-500 rounded-full mr-2"></span> Unanswered</div>
            <div className="flex items-center"><span className="w-5 h-5 bg-purple-500 rounded-full mr-2"></span> Marked for Review</div>
            <div className="flex items-center"><span className="w-5 h-5 bg-gray-300 rounded-full mr-2"></span> Not Visited</div>
            <div className="flex items-center"><span className="w-12 h-12 rounded-lg border-4 border-blue-500 mr-2 text-sm text-center"></span> Current</div>
          </div>
        </div>
      </div>
    </div>
  )
}