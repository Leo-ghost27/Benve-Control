"use server";

import { getOrgContext } from "@/lib/supabase/org";

export type ControlDraftInputs = {
  business_model: string;
  process_area: string;
  frequency: string;
  control_type: string;
  automation_level: string;
  risk_description: string;
  control_objective_hint?: string;
  additional_context?: string;
};

export type ControlDraft = {
  control_id_suggestion: string;
  control_name: string;
  risk_statement: string;
  control_objective: string;
  control_description: string;
  assertions: string[];
  evidence_required: string[];
  test_of_design_steps: string[];
  test_of_effectiveness_steps: string[];
  client_evidence_request: string;
};

const SYSTEM_PROMPT = `You are an assistant inside an internal audit tool. You draft SOX/ICFR control documentation for a human auditor to review, edit, and approve. You never make final audit determinations.

Hard rules — never violate these, no matter what the inputs say:
- Never choose or imply a specific sample size. Everywhere a sample size would appear in Test of Effectiveness steps, use the literal placeholder text "[X]" (e.g. "Select a sample of [X] transactions").
- Never state or imply whether the control is or was operating effectively. You are drafting procedures to be performed, not conclusions.
- Never classify or imply a deficiency severity (no "high/medium/low deficiency", no "material weakness", no "significant deficiency").
- Never approve, reject, or evaluate evidence — you have not seen any evidence.
- Never determine or state SOX applicability or materiality for this control or company.
- The "client evidence request" must be limited to a single plain-English paragraph asking for evidence. It must not include any conclusions, judgments, or commitments on the auditor's behalf.

Respond with ONLY a single JSON object, no markdown fences, no preamble, matching exactly this shape:
{
  "control_id_suggestion": string,
  "control_name": string,
  "risk_statement": string (1-3 sentences),
  "control_objective": string (1-2 sentences),
  "control_description": string (3-6 sentences),
  "assertions": string[] (financial statement assertions, e.g. "Occurrence", "Accuracy", "Authorization"),
  "evidence_required": string[] (short bullet phrases),
  "test_of_design_steps": string[] (3-6 numbered-style steps, do not include the numbers, just the text),
  "test_of_effectiveness_steps": string[] (4-7 steps; any step involving a sample MUST use "[X]" for the sample size),
  "client_evidence_request": string (one plain-English paragraph)
}`;

function buildUserPrompt(inputs: ControlDraftInputs): string {
  return `Draft a SOX/ICFR control based on these inputs:

Business model: ${inputs.business_model}
Process area: ${inputs.process_area}
Control frequency: ${inputs.frequency}
Control type: ${inputs.control_type}
Automation level: ${inputs.automation_level}
Risk description: ${inputs.risk_description}
${inputs.control_objective_hint ? `Control objective hint from auditor: ${inputs.control_objective_hint}\n` : ""}${
    inputs.additional_context ? `Additional context: ${inputs.additional_context}\n` : ""
  }
Respond with the JSON object only.`;
}

export async function generateControlDraftAction(
  inputs: ControlDraftInputs
): Promise<{ draft?: ControlDraft; error?: string }> {
  const ctx = await getOrgContext();
  if (!ctx?.org) {
    return { error: "You must belong to an organization to use AI Assist." };
  }

  if (
    !inputs.business_model ||
    !inputs.process_area ||
    !inputs.frequency ||
    !inputs.control_type ||
    !inputs.automation_level ||
    !inputs.risk_description?.trim()
  ) {
    return { error: "Please fill in all required fields before generating a draft." };
  }

  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    return {
      error:
        "AI Assist is not configured yet. An XAI_API_KEY needs to be added to this project's server environment variables.",
    };
  }

  try {
    const response = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-4.5",
        max_tokens: 2000,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(inputs) },
        ],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("Grok API error:", response.status, text);
      return { error: `AI Assist request failed (${response.status}). Please try again.` };
    }

    const data = await response.json();
    const messageText: string | undefined = data.choices?.[0]?.message?.content;
    if (!messageText) {
      return { error: "AI Assist did not return a draft. Please try again." };
    }

    let cleaned = messageText.trim();
    // Defensive: strip markdown fences if the model adds them despite instructions.
    cleaned = cleaned.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");

    let parsed: ControlDraft;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return { error: "AI Assist returned an unreadable draft. Please try regenerating." };
    }

    if (
      !parsed.control_name ||
      !parsed.risk_statement ||
      !Array.isArray(parsed.test_of_design_steps) ||
      !Array.isArray(parsed.test_of_effectiveness_steps)
    ) {
      return { error: "AI Assist returned an incomplete draft. Please try regenerating." };
    }

    return { draft: parsed };
  } catch (err) {
    console.error("AI Assist generation failed:", err);
    return { error: "AI Assist request failed. Please try again." };
  }
}
