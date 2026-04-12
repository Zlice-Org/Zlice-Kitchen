"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { 
  CheckCircle2, 
  ChevronRight, 
  ChevronLeft, 
  ShieldCheck, 
  AlertTriangle, 
  FileText, 
  Camera, 
  Send,
  Loader2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/lib/auth-context";
import { 
  StepFoodSafety, 
  StepOrderFulfilment, 
  StepPlatformRules, 
  StepSignature 
} from "@/components/verification/verification-steps";

const TOTAL_STEPS = 4;

export default function VerificationPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [currentStep, setCurrentStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState<any>({
    clause_1: false,
    clause_2: false,
    clause_3: false,
    clause_4: false,
    clause_5: false,
    clause_6: false,
    fullName: "",
    kitchenName: "",
    signatureAccepted: false,
    email: ""
  });

  useEffect(() => {
    const saved = localStorage.getItem("kitchen_verification_form");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setFormData((prev: any) => ({ ...prev, ...parsed }));
      } catch (e) {
        console.error("Error parsing saved form", e);
      }
    }
  }, []);

  // Update email from user object
  useEffect(() => {
    if (user?.email) {
      setFormData((prev: any) => ({ ...prev, email: user.email }));
    }
  }, [user]);

  // Save to localStorage when form data changes
  useEffect(() => {
    localStorage.setItem("kitchen_verification_form", JSON.stringify(formData));
  }, [formData]);

  const updateFormData = useCallback((update: any) => {
    setFormData((prev: any) => ({ ...prev, ...update }));
  }, []);

  const isStepValid = useMemo(() => {
    switch (currentStep) {
      case 1: return formData.clause_1 && formData.clause_2;
      case 2: return formData.clause_3 && formData.clause_4;
      case 3: return formData.clause_5 && formData.clause_6;
      case 4: return !!(formData.fullName && formData.kitchenName && formData.signatureAccepted);
      default: return false;
    }
  }, [currentStep, formData]);

  const handleNext = () => {
    if (isStepValid && currentStep < TOTAL_STEPS) {
      setCurrentStep(prev => prev + 1);
      window.scrollTo(0, 0);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(prev => prev - 1);
      window.scrollTo(0, 0);
    }
  };

  const handleSubmit = async () => {
    if (!isStepValid) return;

    console.log("🚀 Starting verification submission...");

    setSubmitting(true);
    const toastId = toast.loading("Submitting your verification...");

    try {
      const submissionData = new FormData();
      submissionData.append("fullName", formData.fullName);
      submissionData.append("kitchenName", formData.kitchenName);

      const response = await fetch("/api/canteen/verify", {
        method: "POST",
        body: submissionData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Submission failed");
      }

      toast.success("Verification submitted! Redirecting...", { id: toastId });
      localStorage.removeItem("kitchen_verification_form");
      window.location.href = "/dashboard"; // Use hard navigation to bypass Next.js middleware cache
    } catch (error: any) {
      console.error("Submission error:", error);
      toast.error(error.message || "Failed to submit. Please check your connection and try again.", { id: toastId });
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;

  const progress = (currentStep / TOTAL_STEPS) * 100;

  return (
    <div className="min-h-[100dvh] bg-slate-50 dark:bg-[#020617] text-slate-900 dark:text-slate-100 pb-32">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-white/80 dark:bg-slate-950/80 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 shadow-sm">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="bg-red-600 text-white p-2 rounded-lg">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Kitchen Partner Verification</h1>
              <p className="text-xs text-slate-500 font-medium uppercase tracking-widest mt-0.5">Zlice Platform Compliance</p>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-6">
             <div className="text-right">
               <p className="text-xs font-bold text-slate-400 uppercase tracking-tighter">Step</p>
               <p className="text-xl font-black text-red-600 leading-none">{currentStep} / {TOTAL_STEPS}</p>
             </div>
          </div>
        </div>
        <Progress value={progress} className="h-1 rounded-none bg-slate-100 dark:bg-slate-900" 
          style={{ '--progress-background': 'rgb(220 38 38)' } as any} 
        />
      </div>

      <main className="max-w-4xl mx-auto px-4 md:px-6 py-8 md:py-12">
        <div className="mb-10 text-center">
           <h2 className="text-3xl md:text-4xl font-black mb-3 text-slate-800 dark:text-slate-100 tracking-tight">
             Legal Undertaking Form
           </h2>
           <p className="text-slate-500 max-w-2xl mx-auto font-medium leading-relaxed">
             Please read each clause carefully. All terms are legally binding for your partnership with Zlice.
           </p>
        </div>

        {/* STEP CONTENT */}
        <div className="min-h-[400px]">
          {currentStep === 1 && <StepFoodSafety data={formData} onUpdate={updateFormData} />}
          {currentStep === 2 && <StepOrderFulfilment data={formData} onUpdate={updateFormData} />}
          {currentStep === 3 && <StepPlatformRules data={formData} onUpdate={updateFormData} />}
          {currentStep === 4 && <StepSignature data={formData} onUpdate={updateFormData} />}
        </div>
      </main>

      {/* Navigation Footer */}
      <div className="fixed bottom-0 inset-x-0 z-50 bg-white/90 dark:bg-slate-950/90 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 py-4 px-6 shadow-2xl">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">
          <Button
            variant="ghost"
            onClick={handleBack}
            disabled={currentStep === 1 || submitting}
            className="group h-12 px-6 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-900 text-slate-600 dark:text-slate-400"
          >
            <ChevronLeft className="mr-2 h-5 w-5 group-hover:-translate-x-1 transition-transform" />
            Back
          </Button>

          <div className="flex items-center gap-2 md:gap-4">
            {currentStep < TOTAL_STEPS ? (
              <Button
                size="lg"
                onClick={handleNext}
                disabled={!isStepValid}
                className={`h-12 px-8 rounded-xl font-bold transition-all shadow-lg ${isStepValid ? "bg-red-600 hover:bg-red-700 shadow-red-900/20" : "bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed"}`}
              >
                Next Step
                <ChevronRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
              </Button>
            ) : (
              <Button
                size="lg"
                onClick={handleSubmit}
                disabled={!isStepValid || submitting}
                className="h-12 px-10 rounded-xl font-black bg-red-600 hover:bg-red-700 shadow-xl shadow-red-900/30 gap-2 transition-all active:scale-95 group"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  <>
                     <Send className="h-5 w-5 group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
                     Complete Verification
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
