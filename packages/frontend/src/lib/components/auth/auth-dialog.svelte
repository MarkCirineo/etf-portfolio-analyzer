<script lang="ts">
	import Button, {
		type ButtonSize,
		type ButtonVariant
	} from "$lib/components/ui/button/button.svelte";
	import Input from "$lib/components/ui/input/input.svelte";
	import * as Dialog from "$lib/components/ui/dialog/index.js";
	import { request } from "$lib/request";
	import { cn } from "$lib/utils.js";

	type AuthMode = "login" | "signup";

	type AuthCopy = Record<
		AuthMode,
		{
			triggerLabel: string;
			title: string;
			description: string;
			actionLabel: string;
			successMessage: string;
			helper: string;
		}
	>;

	const copy: AuthCopy = {
		login: {
			triggerLabel: "Log in",
			title: "Welcome back",
			description: "Enter your credentials to continue. This is a placeholder flow.",
			actionLabel: "Continue",
			successMessage: "Login request accepted. Real authentication is coming soon.",
			helper: "Use any email and password combination. Nothing is stored yet."
		},
		signup: {
			triggerLabel: "Sign up",
			title: "Create an account",
			description: "Start building watchlists once authentication is wired up.",
			actionLabel: "Create account",
			successMessage: "Signup request accepted. We will persist data once storage is ready.",
			helper: "Provide any credentials for now—this UI is only a scaffold."
		}
	};

	type AuthForm = {
		email: string;
		password: string;
	};

	type SubmissionFeedback = {
		message: string | null;
		isError: boolean;
	};

	const buildInitialForm = (): AuthForm => ({
		email: "",
		password: ""
	});

	let {
		mode,
		class: className = "",
		triggerVariant,
		triggerSize = "default"
	}: {
		mode: AuthMode;
		class?: string;
		triggerVariant?: ButtonVariant;
		triggerSize?: ButtonSize;
	} = $props();

	let buttonVariant: ButtonVariant = $state(
		triggerVariant ?? (mode === "signup" ? "default" : "outline")
	);

	$effect(() => {
		buttonVariant = triggerVariant ?? (mode === "signup" ? "default" : "outline");
	});

	let open = $state(false);
	let form: AuthForm = $state(buildInitialForm());
	let isSubmitting = $state(false);

	let feedback: SubmissionFeedback = $state({
		message: null,
		isError: false
	});

	let isSubmitDisabled = $derived(() => !form.email || !form.password || isSubmitting);

	const handleSubmit = async () => {
		if (isSubmitting) return;

		isSubmitting = true;
		feedback = { message: null, isError: false };

		try {
			const response = await request(`/auth/${mode}`, {
				method: "POST",
				body: JSON.stringify({
					email: form.email,
					password: form.password
				})
			});

			type ApiResponse = { message?: string };

			let responseBody: ApiResponse | undefined;
			try {
				responseBody = await response.json();
			} catch {
				responseBody = undefined;
			}

			const serverMessage = responseBody?.message;

			if (!response.ok) {
				throw new Error(serverMessage ?? `Unable to ${mode}.`);
			}

			feedback = {
				message: serverMessage ?? copy[mode].successMessage,
				isError: false
			};

			form = buildInitialForm();
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Something went wrong. Please try again.";

			feedback = {
				message,
				isError: true
			};
		} finally {
			isSubmitting = false;
		}
	};

	const resetState = () => {
		form = buildInitialForm();
		feedback = { message: null, isError: false };
		isSubmitting = false;
	};

	$effect(() => {
		if (!open) {
			resetState();
		}
	});

	const emailId = `auth-${mode}-email`;
	const passwordId = `auth-${mode}-password`;
</script>

<Dialog.Root bind:open>
	<Button
		class={className}
		variant={buttonVariant}
		size={triggerSize}
		aria-haspopup="dialog"
		onclick={() => (open = true)}
	>
		{copy[mode].triggerLabel}
	</Button>

	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>{copy[mode].title}</Dialog.Title>
			<Dialog.Description>{copy[mode].description}</Dialog.Description>
		</Dialog.Header>

		<form
			class="space-y-4"
			onsubmit={(e) => {
				e.preventDefault();
				handleSubmit();
			}}
		>
			<div class="space-y-2">
				<label class="text-foreground text-sm font-medium" for={emailId}>Email</label>
				<Input
					id={emailId}
					type="email"
					placeholder="you@example.com"
					bind:value={form.email}
					required
				/>
			</div>
			<div class="space-y-2">
				<label class="text-foreground text-sm font-medium" for={passwordId}>Password</label>
				<Input
					id={passwordId}
					type="password"
					placeholder="••••••••"
					bind:value={form.password}
					required
					minlength={8}
				/>
			</div>

			<Button type="submit" class="w-full" disabled={isSubmitDisabled()}>
				{isSubmitting ? "Submitting..." : copy[mode].actionLabel}
			</Button>
		</form>

		<div
			class={cn(
				"rounded-md border px-3 py-2 text-sm",
				feedback.message
					? feedback.isError
						? "border-destructive/40 text-destructive"
						: "border-primary/30 text-foreground"
					: "border-border text-muted-foreground"
			)}
			aria-live="polite"
		>
			{feedback.message ?? copy[mode].helper}
		</div>
	</Dialog.Content>
</Dialog.Root>
