import React from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography
} from "@mui/material";
import { OrganizationApi } from "../api/organization.js";
import { useToast } from "../context/ToastContext.jsx";

const emptyProfile = {
  active: false,
  submitterName: "",
  submitterId: "",
  submitterPhone: "",
  billingProviderName: "",
  billingAddress1: "",
  billingAddress2: "",
  billingCity: "",
  billingState: "",
  billingPostalCode: "",
  signatureOnFile: null,
  assignmentOfBenefits: null,
  releaseOfInformation: null,
  professionalPlanParticipationCode: "",
  institutionalPlanParticipationCode: "",
  defaultProfessionalPlaceOfService: "",
  defaultInstitutionalPlaceOfService: ""
};

function booleanChoice(value, onChange, label) {
  return (
    <FormControlLabel
      control={
        <Checkbox
          checked={value === true}
          indeterminate={value == null}
          onChange={(event) =>
            onChange(event.target.checked ? true : false)
          }
        />
      }
      label={label}
    />
  );
}

export default function BillingProfile() {
  const { showToast, showDialog } = useToast();
  const [profile, setProfile] = React.useState(emptyProfile);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    OrganizationApi.getBillingProfile()
      .then((data) => {
        if (!active) return;
        setProfile({ ...emptyProfile, ...(data || {}) });
      })
      .catch((error) => {
        if (!active) return;
        showDialog(error?.message || "Billing profile could not be loaded.", {
          title: "Unable to load billing profile",
          severity: "error"
        });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [showDialog]);

  function set(field, value) {
    setProfile((current) => ({ ...current, [field]: value }));
  }

  async function save() {
    try {
      setSaving(true);
      const saved = await OrganizationApi.updateBillingProfile({
        active: Boolean(profile.active),
        submitterName: profile.submitterName || null,
        submitterId: profile.submitterId || null,
        submitterPhone: profile.submitterPhone || null,
        billingProviderName: profile.billingProviderName || null,
        billingAddress1: profile.billingAddress1 || null,
        billingAddress2: profile.billingAddress2 || null,
        billingCity: profile.billingCity || null,
        billingState: profile.billingState || null,
        billingPostalCode: profile.billingPostalCode || null,
        signatureOnFile: profile.signatureOnFile,
        assignmentOfBenefits: profile.assignmentOfBenefits,
        releaseOfInformation: profile.releaseOfInformation,
        professionalPlanParticipationCode:
          profile.professionalPlanParticipationCode || null,
        institutionalPlanParticipationCode:
          profile.institutionalPlanParticipationCode || null,
        defaultProfessionalPlaceOfService:
          profile.defaultProfessionalPlaceOfService || null,
        defaultInstitutionalPlaceOfService:
          profile.defaultInstitutionalPlaceOfService || null
      });
      setProfile({ ...emptyProfile, ...(saved || {}) });
      showToast("Organization billing / EDI profile saved", "success");
    } catch (error) {
      showDialog(error?.message || "Billing profile could not be saved.", {
        title: "Unable to save billing profile",
        severity: "error"
      });
    } finally {
      setSaving(false);
    }
  }

  const textFields = [
    ["submitterName", "Submitter name"],
    ["submitterId", "Submitter ID"],
    ["submitterPhone", "Submitter phone"],
    ["billingProviderName", "Billing provider legal name"],
    ["billingAddress1", "Billing address 1"],
    ["billingAddress2", "Billing address 2"],
    ["billingCity", "Billing city"],
    ["billingState", "Billing state"],
    ["billingPostalCode", "Billing ZIP / postal code"],
    ["professionalPlanParticipationCode", "Professional plan participation code"],
    ["institutionalPlanParticipationCode", "Institutional plan participation code"],
    ["defaultProfessionalPlaceOfService", "Default professional POS"],
    ["defaultInstitutionalPlaceOfService", "Default institutional POS"]
  ];

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 980, mx: "auto" }}>
      <Typography variant="h4" fontWeight={800} gutterBottom>
        Billing / EDI Profile
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        Organization-specific values used to build production 837 claims.
      </Typography>

      <Alert severity="warning" sx={{ mb: 3 }}>
        Activation does not enable production transmission by itself. Have a
        qualified billing/EDI specialist validate participation codes, place of
        service defaults, attestations, enrollment values and payer-specific
        requirements before enabling live 837 submission.
      </Alert>

      <Paper variant="outlined" sx={{ p: 3 }}>
        {loading ? (
          <Typography>Loading...</Typography>
        ) : (
          <Stack spacing={2.25}>
            <FormControlLabel
              control={
                <Switch
                  checked={Boolean(profile.active)}
                  onChange={(event) => set("active", event.target.checked)}
                />
              }
              label="Profile active"
            />

            {textFields.map(([field, label]) => (
              <TextField
                key={field}
                label={label}
                value={profile[field] || ""}
                onChange={(event) => set(field, event.target.value)}
                fullWidth
                size="small"
              />
            ))}

            <Typography variant="subtitle1" fontWeight={700}>
              Claim attestations
            </Typography>
            <Alert severity="info">
              These are explicit legal/operational settings. Do not enable them
              merely to satisfy claim validation.
            </Alert>

            {booleanChoice(
              profile.signatureOnFile,
              (value) => set("signatureOnFile", value),
              "Signature on file"
            )}
            {booleanChoice(
              profile.assignmentOfBenefits,
              (value) => set("assignmentOfBenefits", value),
              "Assignment of benefits"
            )}
            {booleanChoice(
              profile.releaseOfInformation,
              (value) => set("releaseOfInformation", value),
              "Release of information"
            )}

            <Button
              variant="contained"
              onClick={save}
              disabled={saving}
              sx={{ alignSelf: "flex-start" }}
            >
              {saving ? "Saving..." : "Save Billing / EDI Profile"}
            </Button>
          </Stack>
        )}
      </Paper>
    </Box>
  );
}
