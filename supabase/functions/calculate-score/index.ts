// supabase/functions/calculate-score/index.ts

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

// --- Helper Function for Answer Comparison ---
// This is the same "judge" from our report page
function isAnswerCorrect(qType: string, selected: any, correct: any): boolean {
  if (selected === null || selected === undefined || selected === "") {
    return false;
  }
  if (!Array.isArray(correct) || correct.length === 0) {
    return false;
  }
  try {
    const correctAnswer = correct[0];
    if (qType === 'SINGLE_CHOICE') {
      return String(selected) === String(correctAnswer);
    }
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

// --- Main Function ---
Deno.serve(async (req) => {
  // Handle CORS (required for functions)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { attemptId } = await req.json()
    if (!attemptId) {
      throw new Error("Missing 'attemptId' in request body")
    }

    // Create a Supabase Admin Client
    // This client has full access to your database
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 1. Get the test_id from the attempt
    const { data: attemptData, error: attemptError } = await supabaseAdmin
      .from('User_Test_Attempts')
      .select('test_id')
      .eq('attempt_id', attemptId)
      .single()

    if (attemptError) throw attemptError
    const testId = attemptData.test_id

    // 2. Fetch all User's Answers
    const { data: userAnswers, error: answersError } = await supabaseAdmin
      .from('User_Answer_Responses')
      .select('question_id, selected_answer')
      .eq('attempt_id', attemptId)
    
    if (answersError) throw answersError
    const answerMap = new Map<string, any>()
    userAnswers.forEach(ans => {
      answerMap.set(ans.question_id, ans.selected_answer)
    })

    // 3. Fetch all Correct Answers
    const { data: questionLinks, error: questionsError } = await supabaseAdmin
      .from('Test_Questions_Link')
      .select('Questions(question_id, question_type, correct_answer)')
      .eq('test_id', testId)

    if (questionsError) throw questionsError

    // 4. Calculate Score
    let totalCorrect = 0
    let totalIncorrect = 0

    for (const link of questionLinks) {
      const q = (link.Questions && Array.isArray(link.Questions) ? link.Questions[0] : link.Questions) as any
      if (!q) continue

      const selected_answer = answerMap.get(q.question_id) || null

      if (selected_answer === null) {
        // Unattempted, do nothing
      } else if (isAnswerCorrect(q.question_type, selected_answer, q.correct_answer)) {
        totalCorrect++
      } else {
        totalIncorrect++
      }
    }

    const finalScore = (totalCorrect * 4) - (totalIncorrect * 1)

    // 5. Update the User_Test_Attempts table with the final score
    const { error: updateError } = await supabaseAdmin
      .from('User_Test_Attempts')
      .update({ final_score: finalScore })
      .eq('attempt_id', attemptId)

    if (updateError) throw updateError

    // 6. Return a success message
    return new Response(JSON.stringify({ score: finalScore }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})