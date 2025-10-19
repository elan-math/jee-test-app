// src/app/dashboard/page.tsx
'use client'

import { createClient } from '../../lib/supabaseClient' // Corrected path
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react' // Corrected 'from'
import Spinner from '../../components/Spinner' // Import our spinner

// Define a type for our Test data
type Test = {
  test_id: string;
  name: string;
  duration_minutes: number;
  total_questions: number;
}

export default function Dashboard() {
  const supabase = createClient()
  const router = useRouter()
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [tests, setTests] = useState<Test[]>([])
  const [loading, setLoading] = useState(true)
  const [startingTest, setStartingTest] = useState<string | null>(null) // To show a spinner on the button

  useEffect(() => {
    const fetchData = async () => {
      // 1. Check if user is logged in
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        router.push('/login')
        return
      }
      setUserEmail(session.user.email || null)

      // 2. Fetch the tests from our 'Tests' table
      const { data: testData, error } = await supabase
        .from('Tests')
        .select('*')

      if (error) {
        console.error('Error fetching tests:', error)
      } else if (testData) {
        setTests(testData)
      }
      setLoading(false)
    }
    
    fetchData()
  }, [supabase, router])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  // --- NEW FUNCTION ---
  // This function handles creating the test attempt and redirecting
  const handleStartTest = async (testId: string) => {
    setStartingTest(testId) // Show spinner on this button

    // 1. Get the current user
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      alert('You must be logged in to start a test.')
      router.push('/login')
      return
    }

    // 2. We will add the pre-test goals here later.
    // For now, just create the attempt.
    const { data: newAttempt, error } = await supabase
      .from('User_Test_Attempts')
      .insert({
        user_id: user.id,
        test_id: testId,
        status: 'STARTED',
        // We'll add goal_score and confidence_level from your pre-test modal here
      })
      .select('attempt_id') // Ask Supabase to return the 'attempt_id' of the new row
      .single() // We only expect one row back

    if (error) {
      console.error('Error creating test attempt:', error)
      alert('Could not start the test. Please try again.')
      setStartingTest(null)
    } else if (newAttempt) {
      // 3. Success! Redirect to the new test page.
      router.push(`/test/${newAttempt.attempt_id}`)
    }
  }
  
  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <header className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">Welcome, {userEmail}!</h1>
        <button
          onClick={handleLogout}
          className="bg-red-500 text-white px-4 py-2 rounded-lg hover:bg-red-600"
        >
          Logout
        </button>
      </header>

      <main>
        <h2 className="text-2xl font-semibold mb-4">Available Mock Tests</h2>
        <div className="bg-white p-6 rounded-lg shadow">
          {tests.length > 0 ? (
            <ul className="space-y-4">
              {tests.map((test) => (
                <li key={test.test_id} className="flex flex-col sm:flex-row justify-between items-start sm:items-center p-4 border rounded-lg">
                  <div>
                    <h3 className="text-lg font-medium">{test.name}</h3>
                    <p className="text-sm text-gray-600">
                      {test.total_questions} Questions | {test.duration_minutes} Minutes
                    </p>
                  </div>
                  <button
                    onClick={() => handleStartTest(test.test_id)} // Updated onClick
                    disabled={startingTest === test.test_id} // Disable button while loading
                    className="bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 mt-2 sm:mt-0 disabled:bg-gray-400 w-full sm:w-auto"
                  >
                    {startingTest === test.test_id ? 'Starting...' : 'Start Test'}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p>No tests available at the moment.</p>
          )}
        </div>
      </main>
    </div>
  )
}